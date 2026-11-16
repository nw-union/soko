import { describe, expect, it } from "bun:test";
import { unwrap, unwrapErr } from "../../lib/rslt-test.ts";
import { newPlaylistId, newPlaylistRowId } from "./vo.ts";

describe("newPlaylistId", () => {
  it("英数字と - _ の 10〜64 文字の場合, PlaylistId 型となる", () => {
    expect<string>(unwrap(newPlaylistId("PLabc-DEF_123"))).toBe(
      "PLabc-DEF_123",
    );
  });

  it.each(["", "short", "PL abc def ghi", "PL&key=1234567", 1, null])(
    "不正な値 (%p) の場合, ValidationError となる",
    (src) => {
      expect(unwrapErr(newPlaylistId(src)).type).toBe("ValidationError");
    },
  );
});

describe("newPlaylistRowId", () => {
  it("正の整数の場合, PlaylistRowId 型となる", () => {
    expect<number>(unwrap(newPlaylistRowId(3))).toBe(3);
  });

  it.each([0, -1, 1.5, "1", null])(
    "不正な値 (%p) の場合, ValidationError となる",
    (src) => {
      expect(unwrapErr(newPlaylistRowId(src)).type).toBe("ValidationError");
    },
  );
});
