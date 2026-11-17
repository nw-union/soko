import { describe, expect, it } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { newDatabaseError } from "../../shared/error.ts";
import type { ClockPort } from "../../shared/port.ts";
import type {
  BadgeCounterPort,
  PushRepositoryPort,
  PushSenderPort,
} from "../port.ts";
import type {
  ClaimedVideo,
  NewSubscription,
  PushPayload,
  StoredSubscription,
  VapidKeys,
} from "../type.ts";
import {
  buildPayload,
  classifySendResult,
  newNotifyWorkflow,
  selectRecent,
} from "./notify.ts";

// ----------------------------------------------------------------------------
// Fake・テストデータ
// ----------------------------------------------------------------------------
const NOW = new Date("2026-11-04T00:00:00Z");

const clock: ClockPort = { now: () => NOW };

const VAPID: VapidKeys = {
  publicKey: "PUBLIC",
  privateKey: "PRIVATE",
  subject: "mailto:a@example.com",
};

const sub = (id: number, userId: string): StoredSubscription => ({
  id,
  userId,
  endpoint: `https://fcm.googleapis.com/${id}`,
  p256dh: "k",
  auth: "a",
});

const newFakes = (
  init: {
    claimed?: ClaimedVideo[];
    subs?: StoredSubscription[];
    // 購読 ID → 応答のステータス (文字列なら送れなかった理由)
    statuses?: Record<number, number | string>;
    badgeFails?: boolean;
    vapid?: VapidKeys | null;
  } = {},
) => {
  const upserted: NewSubscription[] = [];
  const trimmed: [string, number][] = [];
  const deleted: [string, string][] = [];
  const removedIds: number[][] = [];
  const sent: { id: number; payload: PushPayload }[] = [];
  const claimedAt: Date[] = [];

  const repo: PushRepositoryPort = {
    upsertSubscription: (s) => {
      upserted.push(s);
      return okAsync(undefined);
    },
    trimSubscriptions: (user, keep) => {
      trimmed.push([user, keep]);
      return okAsync(undefined);
    },
    deleteSubscription: (user, endpoint) => {
      deleted.push([user, endpoint]);
      return okAsync(undefined);
    },
    listSubscriptions: () => okAsync(init.subs ?? []),
    deleteSubscriptions: (ids) => {
      removedIds.push(ids);
      return okAsync(undefined);
    },
    claimUnnotifiedVideos: (now) => {
      claimedAt.push(now);
      return okAsync(init.claimed ?? []);
    },
  };
  const sender: PushSenderPort = {
    send: (s, payload) => {
      sent.push({ id: s.id, payload });
      const status = init.statuses?.[s.id] ?? 201;
      return typeof status === "string" ? errAsync(status) : okAsync(status);
    },
  };
  const badge: BadgeCounterPort = {
    countUnwatchedNew: (ids) =>
      init.badgeFails
        ? errAsync(newDatabaseError("boom"))
        : okAsync(new Map(ids.map((id) => [id, id.length]))),
  };
  return {
    wf: newNotifyWorkflow(
      repo,
      sender,
      badge,
      clock,
      init.vapid === undefined ? VAPID : init.vapid,
    ),
    upserted,
    trimmed,
    deleted,
    removedIds,
    sent,
    claimedAt,
  };
};

const recent: ClaimedVideo = {
  youtubeId: "dQw4w9WgXcQ",
  title: "新しい動画",
  publishedAt: "2026-11-03T00:00:00Z",
};

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";

const video = (id: string, publishedAt: string | null): ClaimedVideo => ({
  youtubeId: id,
  title: `動画 ${id}`,
  publishedAt,
});

const storedSub: StoredSubscription = {
  id: 7,
  userId: "user1",
  endpoint: ENDPOINT,
  p256dh: "x",
  auth: "y",
};

// ----------------------------------------------------------------------------
// notifyNew
// ----------------------------------------------------------------------------
describe("notifyNew", () => {
  it("最近の新着がなければ, 送らない (動画は通知済みにする)", async () => {
    // Arrange:
    const { wf, sent, claimedAt } = newFakes({
      claimed: [{ ...recent, publishedAt: "2026-01-01T00:00:00Z" }],
      subs: [sub(1, "u")],
    });

    // Act:
    const actual = await wf.notifyNew();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ type: "NoRecentVideos" });
    expect(claimedAt).toEqual([NOW]);
    expect(sent).toHaveLength(0);
  });

  it("VAPID の鍵がなければ, 送らない", async () => {
    // Arrange:
    const { wf, sent } = newFakes({
      claimed: [recent],
      subs: [sub(1, "u")],
      vapid: null,
    });

    // Act:
    const actual = await wf.notifyNew();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ type: "NoVapidKeys", videos: 1 });
    expect(sent).toHaveLength(0);
  });

  it("全購読者に, その人のバッジの本数を入れて送る", async () => {
    // Arrange:
    const { wf, sent } = newFakes({
      claimed: [recent],
      subs: [sub(1, "u"), sub(2, "uu")],
    });

    // Act:
    const actual = await wf.notifyNew();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      type: "Notified",
      videos: 1,
      sent: 2,
      total: 2,
      removed: 0,
      failures: [],
      badgeError: null,
    });
    expect(sent).toEqual([
      {
        id: 1,
        payload: {
          title: "新着動画",
          body: "新しい動画",
          url: "/?v=dQw4w9WgXcQ",
          badge: 1,
        },
      },
      {
        id: 2,
        payload: {
          title: "新着動画",
          body: "新しい動画",
          url: "/?v=dQw4w9WgXcQ",
          badge: 2,
        },
      },
    ]);
  });

  it("購読をやめた端末の購読を消し, 他の失敗は理由を返す (1 件の失敗では止めない)", async () => {
    // Arrange:
    const { wf, removedIds, sent } = newFakes({
      claimed: [recent],
      subs: [sub(1, "a"), sub(2, "b"), sub(3, "c"), sub(4, "d")],
      statuses: { 1: 410, 2: 500, 3: "network down" },
    });

    // Act:
    const actual = await wf.notifyNew();

    // Assert:
    expect(actual._unsafeUnwrap()).toMatchObject({
      sent: 1,
      total: 4,
      removed: 1,
      failures: ["500", "network down"],
    });
    expect(removedIds).toEqual([[1]]);
    expect(sent).toHaveLength(4);
  });

  it("バッジの本数を数えられなくても, バッジなしで送る", async () => {
    // Arrange:
    const { wf, sent } = newFakes({
      claimed: [recent],
      subs: [sub(1, "u")],
      badgeFails: true,
    });

    // Act:
    const actual = await wf.notifyNew();

    // Assert:
    expect(actual._unsafeUnwrap()).toMatchObject({
      sent: 1,
      badgeError: "DatabaseError: boom",
    });
    expect(sent[0].payload.badge).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// Step
// ----------------------------------------------------------------------------
describe("selectRecent", () => {
  it("投稿から 3 日以内の動画だけを, 新しい順に選ぶ", () => {
    // Arrange:
    const claimed = [
      video("a", "2026-11-01T00:00:00Z"), // ちょうど 3 日前
      video("b", "2026-10-31T23:59:59Z"), // 3 日より前
      video("c", "2026-11-03T00:00:00Z"),
      video("d", null),
    ];

    // Act:
    const actual = selectRecent(claimed, NOW);

    // Assert:
    expect(actual.map((v) => v.youtubeId)).toEqual(["c", "a"]);
  });
});

describe("buildPayload", () => {
  it("1 本なら「新着動画」で, 押すとその動画を開く", () => {
    expect(buildPayload([video("abc", null)])).toEqual({
      title: "新着動画",
      body: "動画 abc",
      url: "/?v=abc",
    });
  });

  it("複数なら本数を出し, タイトルをつなげ, 押すと先頭 (いちばん新しい) の動画を開く", () => {
    // Act:
    const actual = buildPayload([video("a", null), video("b", null)]);

    // Assert:
    expect(actual).toEqual({
      title: "新着動画が 2 本",
      body: "動画 a / 動画 b",
      url: "/?v=a",
    });
  });

  it("本文は 200 文字に切る", () => {
    // Arrange:
    const long = { youtubeId: "a", title: "あ".repeat(300), publishedAt: null };

    // Act:
    const actual = buildPayload([long]);

    // Assert:
    expect(actual.body).toHaveLength(200);
    expect(actual.body.endsWith("…")).toBeTrue();
  });
});

describe("classifySendResult", () => {
  it.each([
    [201, { type: "Sent" }],
    [404, { type: "Gone", subscriptionId: 7 }],
    [410, { type: "Gone", subscriptionId: 7 }],
    [429, { type: "Failed", reason: "429" }],
    [500, { type: "Failed", reason: "500" }],
  ])("ステータス %d を分類する", (status, expected) => {
    expect(classifySendResult(storedSub, status)).toEqual(expected as never);
  });
});
