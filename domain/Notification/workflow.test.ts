import { describe, expect, it } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { newDatabaseError } from "../../error.ts";
import { bytesToBase64url } from "../base64url.ts";
import type { ClockPort } from "../port.ts";
import type {
  BadgeCounterPort,
  PushRepositoryPort,
  PushSenderPort,
} from "./port.ts";
import type {
  ClaimedVideo,
  NewSubscription,
  PushPayload,
  StoredSubscription,
  VapidKeys,
} from "./type.ts";
import { newNotificationWorkFlows } from "./workflow.ts";

// ----------------------------------------------------------------------------
// Test Data / Fake
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

const deviceKeys = async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  return {
    p256dh: bytesToBase64url(
      new Uint8Array(
        (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
      ),
    ),
    auth: bytesToBase64url(new Uint8Array(16).fill(1)),
  };
};

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
    wf: newNotificationWorkFlows(
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

// ----------------------------------------------------------------------------
// getPublicKey
// ----------------------------------------------------------------------------
describe("getPublicKey", () => {
  it("鍵があれば公開鍵を, なければ null を返す", async () => {
    expect((await newFakes().wf.getPublicKey())._unsafeUnwrap()).toEqual({
      publicKey: "PUBLIC",
    });
    expect(
      (await newFakes({ vapid: null }).wf.getPublicKey())._unsafeUnwrap(),
    ).toEqual({ publicKey: null });
  });
});

// ----------------------------------------------------------------------------
// subscribe / unsubscribe
// ----------------------------------------------------------------------------
describe("subscribe", () => {
  it("購読を保存し, 1 人 10 件を超えた古い購読を消す", async () => {
    // Arrange:
    const { wf, upserted, trimmed } = newFakes();
    const keys = await deviceKeys();

    // Act:
    const actual = await wf.subscribe({
      userId: "user1",
      body: { endpoint: "https://fcm.googleapis.com/x", keys },
    });

    // Assert:
    expect(actual.isOk()).toBeTrue();
    expect(upserted).toHaveLength(1);
    expect(trimmed).toEqual([["user1", 10]]);
  });

  it("購読の内容が正しくない場合, ValidationError となり, 保存しない", async () => {
    // Arrange:
    const { wf, upserted } = newFakes();

    // Act:
    const actual = await wf.subscribe({ userId: "user1", body: {} });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
    expect(upserted).toHaveLength(0);
  });
});

describe("unsubscribe", () => {
  it("自分の購読を消す", async () => {
    // Arrange:
    const { wf, deleted } = newFakes();

    // Act:
    await wf.unsubscribe({ userId: "user1", endpoint: "https://x" });

    // Assert:
    expect(deleted).toEqual([["user1", "https://x"]]);
  });
});

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
