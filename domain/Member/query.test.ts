import { describe, expect, test } from "bun:test";
import { newMemberQueries } from "./query.ts";

describe("newMemberQueries", () => {
  test("Invite と Profile の Query をまとめて返す", () => {
    const qs = newMemberQueries(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(Object.keys(qs).sort()).toEqual(
      ["getAvatarFile", "getDisplayUser", "hasPasskey", "listInvites"].sort(),
    );
  });
});
