import { describe, expect, it } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { newStorageError } from "../../shared/error.ts";
import type { ClockPort, RandomPort } from "../../shared/port.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "../port.ts";
import { AVATAR_MAX_BYTES } from "../rule.ts";
import { newAvatarWorkflow, validateImageFile } from "./avatar.ts";

// ----------------------------------------------------------------------------
// Fake・テストデータ
// ----------------------------------------------------------------------------
const NOW = new Date("2026-11-01T00:00:00Z");

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

const OLD_KEY = `${"00".repeat(16)}.webp`;

const NEW_KEY = `${"ab".repeat(16)}.png`;

const clock: ClockPort = { now: () => NOW };

const random: RandomPort = {
  bytes: (n) => new Uint8Array(n).fill(0xab),
  float: () => 0,
};

const newFakes = (
  init: { image?: string | null; failDelete?: boolean } = {},
) => {
  const images = new Map<string, string | null>([
    ["user1", init.image ?? null],
  ]);
  const updates: { user: string; image: string | null; now: Date }[] = [];
  const deletedUsers: string[] = [];
  const put: string[] = [];
  const removed: string[] = [];

  const repo: ProfileRepositoryPort = {
    countPasskeys: () => okAsync(0),
    readImage: (user) => okAsync(images.get(user) ?? null),
    updateImage: (user, image, now) => {
      images.set(user, image);
      updates.push({ user, image, now });
      return okAsync(undefined);
    },
    deleteUserData: (user) => {
      deletedUsers.push(user);
      return okAsync(undefined);
    },
  };
  const storage: AvatarStoragePort = {
    putAvatar: (key) => {
      put.push(key);
      return okAsync(undefined);
    },
    deleteAvatar: (key) => {
      if (init.failDelete) return errAsync(newStorageError("boom"));
      removed.push(key);
      return okAsync(undefined);
    },
    getAvatar: () => okAsync(null),
  };
  return {
    wf: newAvatarWorkflow(repo, storage, clock, random),
    repo,
    storage,
    updates,
    deletedUsers,
    put,
    removed,
  };
};

// テストで使わないリポジトリのメソッド. 呼ばれたら失敗させる
const notUsed = (): never => {
  throw new Error("このテストでは使わない");
};

// 保存されている画像のキー
const KEY = `${"a".repeat(32)}.png`;

const body = new ReadableStream();

const newQueryFakes = (passkeys = 0, failGet = false) => {
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
  return newAvatarWorkflow(repo, storage, clock, random);
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

// ----------------------------------------------------------------------------
// changeAvatar
// ----------------------------------------------------------------------------
describe("changeAvatar", () => {
  it("画像を保存して user.image を差し替え, 古い画像を消す", async () => {
    // Arrange:
    const { wf, put, updates, removed } = newFakes({
      image: `/files/avatars/${OLD_KEY}`,
    });

    // Act:
    const actual = await wf.changeAvatar({ userId: "user1", file: PNG });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      image: `/files/avatars/${NEW_KEY}`,
    });
    expect(put).toEqual([NEW_KEY]);
    expect(updates).toEqual([
      { user: "user1", image: `/files/avatars/${NEW_KEY}`, now: NOW },
    ]);
    expect(removed).toEqual([OLD_KEY]);
  });

  it("古い画像が外部の URL なら, ストレージからは何も消さない", async () => {
    // Arrange:
    const { wf, removed } = newFakes({ image: "https://example.com/a.png" });

    // Act:
    await wf.changeAvatar({ userId: "user1", file: PNG });

    // Assert:
    expect(removed).toHaveLength(0);
  });

  it("古い画像を消せなくても, 差し替えは成功する", async () => {
    // Arrange:
    const { wf } = newFakes({
      image: `/files/avatars/${OLD_KEY}`,
      failDelete: true,
    });

    // Act:
    const actual = await wf.changeAvatar({ userId: "user1", file: PNG });

    // Assert:
    expect(actual.isOk()).toBeTrue();
  });

  it("画像でない場合, ValidationError となり, 何も保存しない", async () => {
    // Arrange:
    const { wf, put, updates } = newFakes();

    // Act:
    const actual = await wf.changeAvatar({
      userId: "user1",
      file: new Uint8Array([1, 2, 3]),
    });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
    expect(put).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("ストレージへの保存に失敗した場合, user.image は変えない", async () => {
    // Arrange:
    const { repo, updates } = newFakes();
    const failing = newAvatarWorkflow(
      repo,
      {
        putAvatar: () => errAsync(newStorageError("boom")),
        deleteAvatar: () => okAsync(undefined),
        getAvatar: () => okAsync(null),
      },
      clock,
      random,
    );

    // Act:
    const actual = await failing.changeAvatar({ userId: "user1", file: PNG });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("StorageError");
    expect(updates).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// removeAvatar
// ----------------------------------------------------------------------------
describe("removeAvatar", () => {
  it("user.image を空にして, 古い画像を消す", async () => {
    // Arrange:
    const { wf, updates, removed } = newFakes({
      image: `/files/avatars/${OLD_KEY}`,
    });

    // Act:
    const actual = await wf.removeAvatar({ userId: "user1" });

    // Assert:
    expect(actual.isOk()).toBeTrue();
    expect(updates).toEqual([{ user: "user1", image: null, now: NOW }]);
    expect(removed).toEqual([OLD_KEY]);
  });
});

// ----------------------------------------------------------------------------
// getAvatarFile
// ----------------------------------------------------------------------------
describe("getAvatarFile", () => {
  it("保存されている画像を返す", async () => {
    // Act:
    const actual = await newQueryFakes().getAvatarFile({ key: KEY });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      body,
      contentType: "image/png",
      etag: '"e1"',
    });
  });

  it("画像がない場合, NotFoundError となる", async () => {
    // Act:
    const actual = await newQueryFakes().getAvatarFile({
      key: `${"b".repeat(32)}.png`,
    });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("NotFoundError");
  });

  it("キーの形が違う場合, ストレージを読まずに NotFoundError となる", async () => {
    // Act:
    const actual = await newQueryFakes(0, true).getAvatarFile({
      key: "../secret",
    });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("NotFoundError");
  });

  it("ストレージのエラーは, そのまま返す", async () => {
    // Act:
    const actual = await newQueryFakes(0, true).getAvatarFile({ key: KEY });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("StorageError");
  });
});

describe("validateImageFile", () => {
  it.each([
    ["PNG", PNG, "png", "image/png"],
    ["JPEG", JPEG, "jpg", "image/jpeg"],
    ["WebP", WEBP, "webp", "image/webp"],
  ])("%s の場合, 形式を判定する", (_, bytes, ext, contentType) => {
    expect(validateImageFile(bytes)._unsafeUnwrap()).toMatchObject({
      ext,
      contentType,
    });
  });

  it.each([
    ["ファイルがない", null, "画像を選んでください"],
    ["空", new Uint8Array(0), "画像は 2MB 以下にしてください"],
    [
      "2MB を超える",
      new Uint8Array(AVATAR_MAX_BYTES + 1),
      "画像は 2MB 以下にしてください",
    ],
    [
      "画像でない",
      new TextEncoder().encode("<svg></svg>"),
      "JPEG、PNG、WebP の画像を選んでください",
    ],
  ])("%s場合, ValidationError となる", (_, bytes, message) => {
    expect(validateImageFile(bytes)._unsafeUnwrapErr().issues).toEqual({
      file: [message],
    });
  });

  it("ちょうど 2MB なら通す", () => {
    // Arrange:
    const bytes = new Uint8Array(AVATAR_MAX_BYTES);
    bytes.set(PNG);

    // Act / Assert:
    expect(validateImageFile(bytes).isOk()).toBeTrue();
  });
});
