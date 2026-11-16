import { describe, expect, it } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { newStorageError } from "../../shared/error.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "./port.ts";
import { newProfileQueries } from "./query.ts";

// ----------------------------------------------------------------------------
// Test Data / Fake
// ----------------------------------------------------------------------------
// テストで使わないリポジトリのメソッド. 呼ばれたら失敗させる
const notUsed = (): never => {
  throw new Error("このテストでは使わない");
};

// 保存されている画像のキー
const KEY = `${"a".repeat(32)}.png`;
const body = new ReadableStream();

const newFakes = (passkeys = 0, failGet = false) => {
  const repo: ProfileRepositoryPort = {
    countPasskeys: (user) => okAsync(user === "user1" ? passkeys : 0),
    readImage: notUsed,
    updateImage: notUsed,
    deleteUserData: notUsed,
  };
  const storage: AvatarStoragePort = {
    putAvatar: notUsed,
    deleteAvatar: notUsed,
    getAvatar: (key) =>
      failGet
        ? errAsync(newStorageError("boom"))
        : okAsync(
            key === KEY
              ? {
                  type: "AvatarFile",
                  body,
                  contentType: "image/png",
                  etag: '"e1"',
                }
              : null,
          ),
  };
  return newProfileQueries(repo, storage);
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

// ----------------------------------------------------------------------------
// getAvatarFile
// ----------------------------------------------------------------------------
describe("getAvatarFile", () => {
  it("保存されている画像を返す", async () => {
    // Act:
    const actual = await newFakes().getAvatarFile({ key: KEY });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      body,
      contentType: "image/png",
      etag: '"e1"',
    });
  });

  it("画像がない場合, NotFoundError となる", async () => {
    // Act:
    const actual = await newFakes().getAvatarFile({
      key: `${"b".repeat(32)}.png`,
    });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("NotFoundError");
  });

  it("キーの形が違う場合, ストレージを読まずに NotFoundError となる", async () => {
    // Act:
    const actual = await newFakes(0, true).getAvatarFile({ key: "../secret" });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("NotFoundError");
  });

  it("ストレージのエラーは, そのまま返す", async () => {
    // Act:
    const actual = await newFakes(0, true).getAvatarFile({ key: KEY });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("StorageError");
  });
});
