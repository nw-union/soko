import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
import type { ProfileRepositoryPort } from "./port.ts";
import { newProfileQueries } from "./query.ts";

// ----------------------------------------------------------------------------
// Test Data / Fake
// ----------------------------------------------------------------------------
// テストで使わないリポジトリのメソッド. 呼ばれたら失敗させる
const notUsed = (): never => {
  throw new Error("このテストでは使わない");
};

const newFakes = (passkeys = 0) => {
  const repo: ProfileRepositoryPort = {
    countPasskeys: (user) => okAsync(user === "user1" ? passkeys : 0),
    readImage: notUsed,
    updateImage: notUsed,
    deleteUserData: notUsed,
  };
  return newProfileQueries(repo);
};

// ----------------------------------------------------------------------------
// getDisplayUser
// ----------------------------------------------------------------------------
describe("getDisplayUser", () => {
  it("色と画像を, 画面に出してよい値にする", async () => {
    // Act:
    const actual = await newFakes().getDisplayUser({
      user: { id: "user1", name: "たろう", color: null, image: "javascript:x" },
    });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      name: "たろう",
      color: "#3cddb7",
      image: null,
    });
  });
});

// ----------------------------------------------------------------------------
// hasPasskey
// ----------------------------------------------------------------------------
describe("hasPasskey", () => {
  it.each([
    [0, false],
    [1, true],
    [3, true],
  ])("パスキーが %d 個なら %p", async (passkeys, expected) => {
    // Act:
    const actual = await newFakes(passkeys).hasPasskey({ userId: "user1" });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ hasPasskey: expected });
  });
});
