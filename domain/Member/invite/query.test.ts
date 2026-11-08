import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
import type { InviteDto } from "../../../schema/service.ts";
import type { ClockPort } from "../../port.ts";
import type { InviteRepositoryPort } from "./port.ts";
import { newInviteQueries } from "./query.ts";

// ----------------------------------------------------------------------------
// Test Data / Fake
// ----------------------------------------------------------------------------
const NOW = new Date("2026-11-01T00:00:00Z");
const clock: ClockPort = { now: () => NOW };

const invite: InviteDto = {
  id: 1,
  createdAt: "2026-10-30 00:00:00",
  expiresAt: "2026-11-06 00:00:00",
  usedAt: null,
  usedByName: null,
};

// テストで使わないリポジトリのメソッド. 呼ばれたら失敗させる
const notUsed = (): never => {
  throw new Error("このテストでは使わない");
};

const newFakes = (usage: { limit: number | null; used: number }) => {
  const repo: InviteRepositoryPort = {
    listInvites: () => okAsync([invite]),
    readUsage: () => okAsync({ type: "InviteUsage", ...usage }),
    insertInviteIfUnderLimit: notUsed,
    deleteUnusedInvite: notUsed,
    isUsableInvite: notUsed,
    claimInvite: notUsed,
    setInvitedUser: notUsed,
  };
  return newInviteQueries(repo, clock);
};

// ----------------------------------------------------------------------------
// listInvites
// ----------------------------------------------------------------------------
describe("listInvites", () => {
  it("一覧と, 上限・残りの回数を返す", async () => {
    // Act:
    const actual = await newFakes({ limit: 5, used: 2 }).listInvites({
      userId: "user1",
    });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      limit: 5,
      remaining: 3,
      invites: [invite],
    });
  });

  it("ユーザー ID が空の場合, ValidationError となる", async () => {
    // Act:
    const actual = await newFakes({ limit: null, used: 0 }).listInvites({
      userId: "",
    });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
  });
});
