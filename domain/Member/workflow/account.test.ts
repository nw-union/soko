import { describe, expect, it } from "bun:test";
import { isErr } from "@nw-union/nw-utils/lib/rslt";
import {
  errAsync,
  okAsync,
  unwrap,
  unwrapErr,
} from "../../../lib/rslt-test.ts";
import { newDatabaseError, newStorageError } from "../../shared/error.ts";
import type { ClockPort } from "../../shared/port.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "../port.ts";
import {
  ensureFreshSession,
  ensurePasskeyDeletable,
  FRESH_AGE_SECONDS,
  newAccountWorkflow,
} from "./account.ts";

// ----------------------------------------------------------------------------
// Fake・テストデータ
// ----------------------------------------------------------------------------
const NOW = new Date("2026-11-01T00:00:00Z");

const OLD_KEY = `${"00".repeat(16)}.webp`;

const clock: ClockPort = { now: () => NOW };

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
    wf: newAccountWorkflow(repo, storage, clock),
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
  return newAccountWorkflow(repo, storage, clock);
};

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
    expect(isErr(actual)).toBeFalse();
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
    const wf = newAccountWorkflow(
      { ...repo, deleteUserData: () => errAsync(newDatabaseError("boom")) },
      storage,
      clock,
    );

    // Act:
    const actual = await wf.cleanupDeletedUser({
      userId: "user1",
      image: null,
    });

    // Assert:
    expect(unwrapErr(actual).type).toBe("DatabaseError");
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
    expect(unwrapErr(actual)).toMatchObject({
      type: "ForbiddenError",
      code: "SESSION_NOT_FRESH",
    });
  });
});

// ----------------------------------------------------------------------------
// checkOAuthConsent
// ----------------------------------------------------------------------------
describe("checkOAuthConsent", () => {
  it("ログインし直したばかりなら受け付ける", async () => {
    // Act:
    const actual = await newFakes().wf.checkOAuthConsent({
      sessionCreatedAt: new Date(NOW.getTime() - 60 * 1000),
    });

    // Assert:
    expect(isErr(actual)).toBeFalse();
  });

  it("ログインから時間がたっていれば, SESSION_NOT_FRESH の ForbiddenError となる", async () => {
    // Act:
    const actual = await newFakes().wf.checkOAuthConsent({
      sessionCreatedAt: new Date(NOW.getTime() - 11 * 60 * 1000),
    });

    // Assert:
    expect(unwrapErr(actual)).toMatchObject({
      type: "ForbiddenError",
      code: "SESSION_NOT_FRESH",
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
    const actual = await newQueryFakes(passkeys).hasPasskey({
      userId: "user1",
    });

    // Assert:
    expect(unwrap(actual)).toEqual({ hasPasskey: expected });
  });
});

// ----------------------------------------------------------------------------
// Step
// ----------------------------------------------------------------------------
describe("ensureFreshSession", () => {
  const now = new Date("2026-11-01T00:10:00Z");

  it("10 分より前に作られたセッションなら受け付ける", () => {
    const fresh = new Date(now.getTime() - (FRESH_AGE_SECONDS - 1) * 1000);
    expect(isErr(ensureFreshSession(fresh, now))).toBeFalse();
  });

  it("10 分以上たっていれば, SESSION_NOT_FRESH の ForbiddenError となる", () => {
    const stale = new Date(now.getTime() - FRESH_AGE_SECONDS * 1000);
    expect(unwrapErr(ensureFreshSession(stale, now))).toEqual({
      type: "ForbiddenError",
      message: "Session is not fresh",
      code: "SESSION_NOT_FRESH",
    });
  });
});

describe("ensurePasskeyDeletable", () => {
  const now = new Date("2026-11-01T00:10:00Z");
  const fresh = new Date(now.getTime() - (FRESH_AGE_SECONDS - 1) * 1000);
  const stale = new Date(now.getTime() - FRESH_AGE_SECONDS * 1000);

  it("ログインし直したばかりで, パスキーが 2 つ以上あれば削除できる", () => {
    expect(isErr(ensurePasskeyDeletable(fresh, 2, now))).toBeFalse();
  });

  it("ログインから 10 分以上たっていれば, SESSION_NOT_FRESH の ForbiddenError となる", () => {
    // Act:
    const actual = ensurePasskeyDeletable(stale, 2, now);

    // Assert:
    expect(unwrapErr(actual)).toEqual({
      type: "ForbiddenError",
      message: "Session is not fresh",
      code: "SESSION_NOT_FRESH",
    });
  });

  it("最後のパスキーは削除できない", () => {
    // Act:
    const actual = ensurePasskeyDeletable(fresh, 1, now);

    // Assert:
    expect(unwrapErr(actual)).toMatchObject({
      type: "ValidationError",
      issues: {
        passkey: ["最後のパスキーは削除できません（ログインできなくなります）"],
      },
    });
  });
});
