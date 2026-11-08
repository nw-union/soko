import { describe, expect, test } from "bun:test";
import { newMemberWorkFlows } from "./workflow.ts";

describe("newMemberWorkFlows", () => {
  test("Invite と Profile の WorkFlow をまとめて返す", () => {
    const wf = newMemberWorkFlows(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(Object.keys(wf).sort()).toEqual(
      [
        "changeAvatar",
        "checkPasskeyDeletion",
        "claimInvite",
        "cleanupDeletedUser",
        "getDisplayUser",
        "hasPasskey",
        "issueInvite",
        "linkInvitedUser",
        "listInvites",
        "removeAvatar",
        "revokeInvite",
        "startInvite",
        "validateProfileUpdate",
        "validateSignUp",
      ].sort(),
    );
  });
});
