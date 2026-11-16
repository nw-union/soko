import { describe, expect, test } from "bun:test";
import { newMemberUsecase } from "./usecase.ts";

describe("newMemberUsecase", () => {
  test("招待とプロフィールのコマンドと Query をまとめて返す", () => {
    const uc = newMemberUsecase(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(Object.keys(uc).sort()).toEqual(
      [
        // Commands: 招待
        "issueInvite",
        "revokeInvite",
        "startInvite",
        "claimInvite",
        "linkInvitedUser",
        // Commands: プロフィール・ログイン
        "validateProfileUpdate",
        "validateSignUp",
        "changeAvatar",
        "removeAvatar",
        "cleanupDeletedUser",
        "checkPasskeyDeletion",
        // Queries
        "listInvites",
        "getDisplayUser",
        "hasPasskey",
        "getAvatarFile",
      ].sort(),
    );
  });
});
