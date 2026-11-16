import { describe, expect, it } from "bun:test";
import { newUserId, newYoutubeId } from "./vo.ts";

// 他のテストで、検証済みの VO を手早く作るためのもの
export const mustUserId = (s: string) => newUserId(s)._unsafeUnwrap();
export const mustYoutubeId = (s: string) => newYoutubeId(s)._unsafeUnwrap();

// ----------------------------------------------------------------------------

describe("newUserId", () => {
  it("空でない文字列の場合, UserId 型となる", () => {
    // Act:
    const actual = newUserId("abcDEF123");

    // Assert:
    expect<string>(actual._unsafeUnwrap()).toBe("abcDEF123");
  });

  it("空文字の場合, ValidationError となる", () => {
    // Act:
    const actual = newUserId("");

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
  });

  it("文字列でない場合, ValidationError となる", () => {
    // Act:
    const actual = newUserId(undefined);

    // Assert:
    expect(actual.isErr()).toBeTrue();
  });
});

describe("newYoutubeId", () => {
  it("英数字・ハイフン・アンダースコアの 11 文字の場合, YoutubeId 型となる", () => {
    // Act:
    const actual = newYoutubeId("dQw4w9WgX-_");

    // Assert:
    expect<string>(actual._unsafeUnwrap()).toBe("dQw4w9WgX-_");
  });

  it.each([
    ["10 文字", "dQw4w9WgXc"],
    ["12 文字", "dQw4w9WgXcQQ"],
    ["URL に使えない文字を含む", "dQw4w9Wg<cQ"],
    ["空文字", ""],
  ])("%s の場合, ValidationError となる", (_, input) => {
    // Act:
    const actual = newYoutubeId(input);

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
  });

  it("フィールド名を指定した場合, そのフィールド名でエラーを返す", () => {
    // Act:
    const actual = newYoutubeId("bad", "videoId");

    // Assert:
    expect(Object.keys(actual._unsafeUnwrapErr().issues)).toEqual(["videoId"]);
  });
});
