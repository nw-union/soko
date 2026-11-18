import { describe, expect, test } from "bun:test";
import { parseScopes } from "./connection.ts";

describe("parseScopes", () => {
  test.each([
    // D1 に入っている形（JSON の文字列の JSON の文字列）
    [
      '"[\\"videos:read\\",\\"offline_access\\"]"',
      ["videos:read", "offline_access"],
    ],
    ['["videos:read","offline_access"]', ["videos:read", "offline_access"]],
    ["videos:read offline_access", ["videos:read", "offline_access"]],
    ["", []],
    [null, []],
  ])("%p → %p", (raw, expected) => {
    expect(parseScopes(raw)).toEqual(expected);
  });
});
