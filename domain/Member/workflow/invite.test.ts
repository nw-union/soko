import { describe, expect, it } from "bun:test";
import { isErr } from "@nw-union/nw-utils/lib/rslt";
import {
  errAsync,
  okAsync,
  unwrap,
  unwrapErr,
} from "../../../lib/rslt-test.ts";
import { newDatabaseError } from "../../shared/error.ts";
import type { ClockPort, RandomPort } from "../../shared/port.ts";
import { mustUserId } from "../../shared/vo.test.ts";
import type { InviteRepositoryPort } from "../port.ts";
import type { InviteUsage, IssuedInvite, NewInvite } from "../type.ts";
import { createTokenHash, type InviteToken, newInviteToken } from "../vo.ts";
import {
  createNewInvite,
  DEFAULT_INVITE_LIMIT,
  ensureIssued,
  ensureUsable,
  limitOf,
  newInviteWorkflow,
  normalizeToken,
  remainingOf,
  validateInviteId,
  validateToken,
} from "./invite.ts";

// ----------------------------------------------------------------------------
// Fake・テストデータ
// ----------------------------------------------------------------------------
const NOW = new Date("2026-11-01T00:00:00Z");

const TOKEN = "ABCDEFGHJKMNPQRS";

const TOKEN_HASH = await createTokenHash(TOKEN as InviteToken);

const clock: ClockPort = { now: () => NOW };

// バイト 0..15 → "ABCDEFGHJKMNPQRS"
const random: RandomPort = {
  bytes: (n) => Uint8Array.from({ length: n }, (_, i) => i),
  float: () => 0,
};

const invite: IssuedInvite = {
  type: "IssuedInvite",
  id: 1,
  createdAt: "2026-10-30 00:00:00",
  expiresAt: "2026-11-06 00:00:00",
  usedAt: null,
  usedByName: null,
};

type State = {
  limit: number | null;
  used: number;
  // 使える招待のハッシュ
  usable: Set<string>;
};

const newFakes = (init: Partial<State> = {}) => {
  const state: State = {
    limit: null,
    used: 0,
    usable: new Set([TOKEN_HASH]),
    ...init,
  };
  const inserted: NewInvite[] = [];
  const deleted: { id: number; inviter: string }[] = [];
  const claimedAt: Date[] = [];
  const linked: { hash: string; user: string }[] = [];

  const repo: InviteRepositoryPort = {
    listInvites: () => okAsync([invite]),
    readUsage: () =>
      okAsync({ type: "InviteUsage", limit: state.limit, used: state.used }),
    insertInviteIfUnderLimit: (i, defaultLimit) => {
      if (state.used >= (state.limit ?? defaultLimit)) return okAsync(false);
      state.used++;
      inserted.push(i);
      return okAsync(true);
    },
    deleteUnusedInvite: (id, inviter) => {
      deleted.push({ id, inviter });
      return okAsync(undefined);
    },
    isUsableInvite: (h) => okAsync(state.usable.has(h)),
    claimInvite: (h, now) => {
      if (!state.usable.delete(h)) return okAsync(false);
      claimedAt.push(now);
      return okAsync(true);
    },
    setInvitedUser: (hash, user) => {
      linked.push({ hash, user });
      return okAsync(undefined);
    },
  };
  return {
    wf: newInviteWorkflow(repo, clock, random),
    repo,
    inserted,
    deleted,
    claimedAt,
    linked,
  };
};

// テストで使わないリポジトリのメソッド. 呼ばれたら失敗させる
const notUsed = (): never => {
  throw new Error("このテストでは使わない");
};

const newListFakes = (usage: { limit: number | null; used: number }) => {
  const repo: InviteRepositoryPort = {
    listInvites: () => okAsync([invite]),
    readUsage: () => okAsync({ type: "InviteUsage", ...usage }),
    insertInviteIfUnderLimit: notUsed,
    deleteUnusedInvite: notUsed,
    isUsableInvite: notUsed,
    claimInvite: notUsed,
    setInvitedUser: notUsed,
  };
  return newInviteWorkflow(repo, clock, random);
};

export const mustInviteToken = (s: string) => unwrap(newInviteToken(s));

const usage = (limit: number | null, used: number): InviteUsage => ({
  type: "InviteUsage",
  limit,
  used,
});

// ----------------------------------------------------------------------------
// invite
// ----------------------------------------------------------------------------
describe("invite", () => {
  it("トークンのハッシュと 7 日後の期限で保存し, 画面に出す形のトークンを返す", async () => {
    // Arrange:
    const { wf, inserted } = newFakes();

    // Act:
    const actual = await wf.invite({ userId: "user1" });

    // Assert:
    expect(unwrap(actual)).toEqual({
      token: "ABCD-EFGH-JKMN-PQRS",
      days: 7,
    });
    expect(inserted).toHaveLength(1);
    expect<string>(inserted[0].tokenHash).toBe(TOKEN_HASH);
    expect<string>(inserted[0].inviterUserId).toBe("user1");
    expect(inserted[0].expiresAt.toISOString()).toBe(
      "2026-11-08T00:00:00.000Z",
    );
  });

  it("上限 (初期値 3) に達している場合, ConflictError となり保存しない", async () => {
    // Arrange:
    const { wf, inserted } = newFakes({ used: 3 });

    // Act:
    const actual = await wf.invite({ userId: "user1" });

    // Assert:
    expect(unwrapErr(actual).type).toBe("ConflictError");
    expect(inserted).toHaveLength(0);
  });

  it("DB エラーの場合, そのまま DatabaseError を返す", async () => {
    // Arrange:
    const { repo } = newFakes();
    const wf = newInviteWorkflow(
      {
        ...repo,
        insertInviteIfUnderLimit: () => errAsync(newDatabaseError("boom")),
      },
      clock,
      random,
    );

    // Act:
    const actual = await wf.invite({ userId: "user1" });

    // Assert:
    expect(unwrapErr(actual).type).toBe("DatabaseError");
  });
});

// ----------------------------------------------------------------------------
// revokeInvite
// ----------------------------------------------------------------------------
describe("revokeInvite", () => {
  it("自分の招待として, 指定した ID の招待を消す", async () => {
    // Arrange:
    const { wf, deleted } = newFakes();

    // Act:
    const actual = await wf.revokeInvite({ userId: "user1", id: "12" });

    // Assert:
    expect(isErr(actual)).toBeFalse();
    expect(deleted).toEqual([{ id: 12, inviter: "user1" }]);
  });

  it("ID が数値でない場合, ValidationError となり消さない", async () => {
    // Arrange:
    const { wf, deleted } = newFakes();

    // Act:
    const actual = await wf.revokeInvite({ userId: "user1", id: "abc" });

    // Assert:
    expect(unwrapErr(actual).type).toBe("ValidationError");
    expect(deleted).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// startInvite
// ----------------------------------------------------------------------------
describe("startInvite", () => {
  it("使える招待の場合, 正規化したトークンを返す", async () => {
    // Act:
    const actual = await newFakes().wf.startInvite({
      token: "abcd-efgh-jkmn-pqrs",
    });

    // Assert:
    expect(unwrap(actual)).toEqual({ token: TOKEN });
  });

  it.each([
    ["形式が違う", "ABCD"],
    ["存在しない (使用済み・期限切れも含む)", "ZZZZ-ZZZZ-ZZZZ-ZZZZ"],
  ])("%s場合, 同じ ValidationError となる", async (_, token) => {
    // Act:
    const actual = await newFakes().wf.startInvite({ token });

    // Assert:
    expect(unwrapErr(actual)).toMatchObject({
      type: "ValidationError",
      issues: { token: ["招待コードが正しくないか、期限切れです"] },
    });
  });
});

// ----------------------------------------------------------------------------
// claimInvite / linkInvitedUser
// ----------------------------------------------------------------------------
describe("claimInvite", () => {
  it("使える招待を, 今の日時で使用済みにする", async () => {
    // Arrange:
    const { wf, claimedAt } = newFakes();

    // Act:
    const actual = await wf.claimInvite({ token: TOKEN });

    // Assert:
    expect(isErr(actual)).toBeFalse();
    expect(claimedAt).toEqual([NOW]);
  });

  it("同じ招待を 2 回使おうとした場合, 2 回目は ValidationError となる", async () => {
    // Arrange:
    const { wf } = newFakes();
    await wf.claimInvite({ token: TOKEN });

    // Act:
    const actual = await wf.claimInvite({ token: TOKEN });

    // Assert:
    expect(unwrapErr(actual).type).toBe("ValidationError");
  });

  it("Cookie がない場合, ValidationError となる", async () => {
    // Act:
    const actual = await newFakes().wf.claimInvite({ token: null });

    // Assert:
    expect(unwrapErr(actual).type).toBe("ValidationError");
  });
});

describe("linkInvitedUser", () => {
  it("トークンのハッシュの招待に, ユーザーを結び付ける", async () => {
    // Arrange:
    const { wf, linked } = newFakes();

    // Act:
    const actual = await wf.linkInvitedUser({ token: TOKEN, userId: "user2" });

    // Assert:
    expect(isErr(actual)).toBeFalse();
    expect(linked).toEqual([{ hash: TOKEN_HASH, user: "user2" }]);
  });
});

// ----------------------------------------------------------------------------
// listInvites
// ----------------------------------------------------------------------------
describe("listInvites", () => {
  it("一覧と, 上限・残りの回数を返す", async () => {
    // Act:
    const actual = await newListFakes({ limit: 5, used: 2 }).listInvites({
      userId: "user1",
    });

    // Assert:
    expect(unwrap(actual)).toEqual({
      limit: 5,
      remaining: 3,
      invites: [
        {
          id: 1,
          createdAt: "2026-10-30 00:00:00",
          expiresAt: "2026-11-06 00:00:00",
          usedAt: null,
          usedByName: null,
        },
      ],
    });
  });

  it("ユーザー ID が空の場合, ValidationError となる", async () => {
    // Act:
    const actual = await newListFakes({ limit: null, used: 0 }).listInvites({
      userId: "",
    });

    // Assert:
    expect(unwrapErr(actual).type).toBe("ValidationError");
  });
});

// ----------------------------------------------------------------------------
// Step
// ----------------------------------------------------------------------------
describe("createNewInvite", () => {
  it("期限は発行から 7 日後になる", () => {
    // Arrange:
    const now = new Date("2026-11-01T00:00:00Z");

    // Act:
    const actual = createNewInvite(
      mustInviteToken(TOKEN),
      "0".repeat(64) as never,
      mustUserId("user1"),
      now,
    );

    // Assert:
    expect(actual.expiresAt.toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });
});

describe("limitOf / remainingOf", () => {
  it("user.inviteLimit がなければ, 初期値を上限にする", () => {
    expect(limitOf(usage(null, 0))).toBe(DEFAULT_INVITE_LIMIT);
  });

  it("user.inviteLimit があれば, それを上限にする", () => {
    expect(limitOf(usage(10, 0))).toBe(10);
  });

  it("残りは, 上限から数える招待の数を引いたもの", () => {
    expect(remainingOf(usage(5, 2))).toBe(3);
  });

  it("上限を下げて使った数の方が多くなっても, 残りは 0 になる", () => {
    expect(remainingOf(usage(1, 3))).toBe(0);
  });
});

describe("ensureIssued", () => {
  it("保存できなかった場合, 上限に達した ConflictError となる", () => {
    // Act:
    const actual = ensureIssued(false);

    // Assert:
    expect(unwrapErr(actual)).toEqual({
      type: "ConflictError",
      message: "招待の発行上限に達しています",
    });
  });

  it("保存できた場合, 成功となる", () => {
    expect(isErr(ensureIssued(true))).toBeFalse();
  });
});

describe("ensureUsable", () => {
  it("使えなかった場合, 理由を教えない ValidationError となる", () => {
    // Act:
    const actual = ensureUsable(false);

    // Assert:
    expect(unwrapErr(actual).issues).toEqual({
      token: ["招待コードが正しくないか、期限切れです"],
    });
  });
});

// ----------------------------------------------------------------------------
// Step: バリデーション
// ----------------------------------------------------------------------------
describe("normalizeToken", () => {
  it("小文字・ハイフン・空白を無視する", () => {
    expect(normalizeToken(" abcd-efgh jkmn-pqrs ")).toBe(TOKEN);
  });
});

describe("validateToken", () => {
  it("画面に出す形 (ハイフン区切り・小文字) でも, 正規化して InviteToken になる", () => {
    // Act:
    const actual = validateToken("abcd-efgh-jkmn-pqrs");

    // Assert:
    expect<string>(unwrap(actual)).toBe(TOKEN);
  });

  it.each([
    ["短い", "ABCD-EFGH-JKMN"],
    ["長い", "ABCD-EFGH-JKMN-PQRS-T"],
    ["使わない文字 (O) を含む", "ABCD-EFGH-JKMN-PQRO"],
    ["文字列でない", 1234],
    ["空", undefined],
  ])("%s 場合, 理由を教えない ValidationError となる", (_, input) => {
    // Act:
    const actual = validateToken(input);

    // Assert:
    expect(unwrapErr(actual).issues).toEqual({
      token: ["招待コードが正しくないか、期限切れです"],
    });
  });
});

describe("validateInviteId", () => {
  it("整数の文字列の場合, InviteId になる", () => {
    expect<number>(unwrap(validateInviteId("12"))).toBe(12);
  });

  it.each([
    ["数値でない", "abc"],
    ["小数", "1.5"],
    ["ない", undefined],
  ])("%s場合, ValidationError となる", (_, input) => {
    // Act:
    const actual = validateInviteId(input);

    // Assert:
    expect(unwrapErr(actual).issues).toEqual({
      id: ["id が正しくありません"],
    });
  });
});
