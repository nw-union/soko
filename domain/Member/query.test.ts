import { describe, expect, test } from "bun:test";
import { newMemberQueries } from "./query.ts";

describe("newMemberQueries", () => {
  test("Invite と Profile の Query をまとめて返す", () => {
    const q = newMemberQueries({} as never, {} as never, {} as never);
    expect(Object.keys(q).sort()).toEqual(
      ["getDisplayUser", "hasPasskey", "listInvites"].sort(),
    );
  });
});
