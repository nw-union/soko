import { describe, expect, it } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { newDatabaseError } from "../../../error.ts";
import type { InviteDto } from "../../../schema/service.ts";
import type { ClockPort, RandomPort } from "../../port.ts";
import type { InviteRepositoryPort } from "./port.ts";
import type { NewInvite } from "./type.ts";
import { createTokenHash, type InviteToken } from "./vo.ts";
import { newInviteWorkFlows } from "./workflow.ts";

// ----------------------------------------------------------------------------
// Test Data / Fake
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

const invite: InviteDto = {
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
    wf: newInviteWorkFlows(repo, clock, random),
    repo,
    inserted,
    deleted,
    claimedAt,
    linked,
  };
};

// ----------------------------------------------------------------------------
// issueInvite
// ----------------------------------------------------------------------------
describe("issueInvite", () => {
  it("トークンのハッシュと 7 日後の期限で保存し, 画面に出す形のトークンを返す", async () => {
    // Arrange:
    const { wf, inserted } = newFakes();

    // Act:
    const actual = await wf.issueInvite({ userId: "user1" });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
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
    const actual = await wf.issueInvite({ userId: "user1" });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ConflictError");
    expect(inserted).toHaveLength(0);
  });

  it("DB エラーの場合, そのまま DatabaseError を返す", async () => {
    // Arrange:
    const { repo } = newFakes();
    const wf = newInviteWorkFlows(
      {
        ...repo,
        insertInviteIfUnderLimit: () => errAsync(newDatabaseError("boom")),
      },
      clock,
      random,
    );

    // Act:
    const actual = await wf.issueInvite({ userId: "user1" });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("DatabaseError");
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
    expect(actual.isOk()).toBeTrue();
    expect(deleted).toEqual([{ id: 12, inviter: "user1" }]);
  });

  it("ID が数値でない場合, ValidationError となり消さない", async () => {
    // Arrange:
    const { wf, deleted } = newFakes();

    // Act:
    const actual = await wf.revokeInvite({ userId: "user1", id: "abc" });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
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
    expect(actual._unsafeUnwrap()).toEqual({ token: TOKEN });
  });

  it.each([
    ["形式が違う", "ABCD"],
    ["存在しない (使用済み・期限切れも含む)", "ZZZZ-ZZZZ-ZZZZ-ZZZZ"],
  ])("%s場合, 同じ ValidationError となる", async (_, token) => {
    // Act:
    const actual = await newFakes().wf.startInvite({ token });

    // Assert:
    expect(actual._unsafeUnwrapErr()).toMatchObject({
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
    expect(actual.isOk()).toBeTrue();
    expect(claimedAt).toEqual([NOW]);
  });

  it("同じ招待を 2 回使おうとした場合, 2 回目は ValidationError となる", async () => {
    // Arrange:
    const { wf } = newFakes();
    await wf.claimInvite({ token: TOKEN });

    // Act:
    const actual = await wf.claimInvite({ token: TOKEN });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
  });

  it("Cookie がない場合, ValidationError となる", async () => {
    // Act:
    const actual = await newFakes().wf.claimInvite({ token: null });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
  });
});

describe("linkInvitedUser", () => {
  it("トークンのハッシュの招待に, ユーザーを結び付ける", async () => {
    // Arrange:
    const { wf, linked } = newFakes();

    // Act:
    const actual = await wf.linkInvitedUser({ token: TOKEN, userId: "user2" });

    // Assert:
    expect(actual.isOk()).toBeTrue();
    expect(linked).toEqual([{ hash: TOKEN_HASH, user: "user2" }]);
  });
});
