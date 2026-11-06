import { describe, expect, it } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { newDatabaseError, newStorageError } from "../../error.ts";
import type { ClockPort, RandomPort } from "../port.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "./port.ts";
import { newProfileWorkFlows } from "./workflow.ts";

// ----------------------------------------------------------------------------
// Test Data / Fake
// ----------------------------------------------------------------------------
const NOW = new Date("2026-11-01T00:00:00Z");
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const OLD_KEY = `${"00".repeat(16)}.webp`;
const NEW_KEY = `${"ab".repeat(16)}.png`;

const clock: ClockPort = { now: () => NOW };
const random: RandomPort = { bytes: (n) => new Uint8Array(n).fill(0xab) };

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
  };
  return {
    wf: newProfileWorkFlows(repo, storage, clock, random),
    repo,
    storage,
    updates,
    deletedUsers,
    put,
    removed,
  };
};

// ----------------------------------------------------------------------------
// validateProfileUpdate / validateSignUp
// ----------------------------------------------------------------------------
describe("validateProfileUpdate", () => {
  it("検証した値を, 送られてきた項目だけ返す", async () => {
    // Act:
    const actual = await newFakes().wf.validateProfileUpdate({
      name: " たろう ",
    });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ name: "たろう" });
  });
});

describe("validateSignUp", () => {
  const email = "4dde6d9e-55c0-4c17-ade9-06deb4dd224e@nwu.invalid";

  it("使い捨てのメールアドレスと正しい名前なら, 検証した値を返す", async () => {
    // Act:
    const actual = await newFakes().wf.validateSignUp({
      email,
      name: "ゲスト",
    });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ name: "ゲスト" });
  });

  it("メールアドレスが違う場合, 名前より先にメールアドレスのエラーを返す", async () => {
    // Act:
    const actual = await newFakes().wf.validateSignUp({
      email: "someone@example.com",
      name: "",
    });

    // Assert:
    expect(actual._unsafeUnwrapErr()).toMatchObject({
      issues: { email: ["登録できません"] },
    });
  });
});

// ----------------------------------------------------------------------------
// getDisplayUser
// ----------------------------------------------------------------------------
describe("getDisplayUser", () => {
  it("色と画像を, 画面に出してよい値にする", async () => {
    // Act:
    const actual = await newFakes().wf.getDisplayUser({
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
    const failing = newProfileWorkFlows(
      repo,
      {
        putAvatar: () => errAsync(newStorageError("boom")),
        deleteAvatar: () => okAsync(undefined),
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
// cleanupDeletedUser
// ----------------------------------------------------------------------------
describe("cleanupDeletedUser", () => {
  it("アイコン画像と, ユーザーのデータを消す", async () => {
    // Arrange:
    const { wf, removed, deletedUsers } = newFakes();

    // Act:
    const actual = await wf.cleanupDeletedUser({
      userId: "user1",
      image: `/files/avatars/${OLD_KEY}`,
    });

    // Assert:
    expect(actual.isOk()).toBeTrue();
    expect(removed).toEqual([OLD_KEY]);
    expect(deletedUsers).toEqual(["user1"]);
  });

  it("アイコン画像を消せなくても, ユーザーのデータは消す", async () => {
    // Arrange:
    const { wf, deletedUsers } = newFakes({ failDelete: true });

    // Act:
    await wf.cleanupDeletedUser({
      userId: "user1",
      image: `/files/avatars/${OLD_KEY}`,
    });

    // Assert:
    expect(deletedUsers).toEqual(["user1"]);
  });

  it("DB エラーの場合, DatabaseError を返す", async () => {
    // Arrange:
    const { repo, storage } = newFakes();
    const wf = newProfileWorkFlows(
      { ...repo, deleteUserData: () => errAsync(newDatabaseError("boom")) },
      storage,
      clock,
      random,
    );

    // Act:
    const actual = await wf.cleanupDeletedUser({
      userId: "user1",
      image: null,
    });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("DatabaseError");
  });
});

// ----------------------------------------------------------------------------
// checkPasskeyDeletion
// ----------------------------------------------------------------------------
describe("checkPasskeyDeletion", () => {
  it("今の時計を使って, セッションが新しいか確かめる", async () => {
    // Act:
    const actual = await newFakes().wf.checkPasskeyDeletion({
      sessionCreatedAt: new Date(NOW.getTime() - 11 * 60 * 1000),
      passkeyCount: 2,
    });

    // Assert:
    expect(actual._unsafeUnwrapErr()).toMatchObject({
      type: "ForbiddenError",
      code: "SESSION_NOT_FRESH",
    });
  });
});
