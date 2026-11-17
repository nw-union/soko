import { describe, expect, it } from "bun:test";
import { isErr } from "@nw-union/nw-utils/lib/rslt";
import { unwrap, unwrapErr } from "../../../lib/rslt-test.ts";
import {
  newProfileWorkflow,
  validateProfileInput,
  validateSignupEmail,
} from "./profile.ts";

// ----------------------------------------------------------------------------
// validateProfileUpdate / validateSignUp
// ----------------------------------------------------------------------------
describe("validateProfileUpdate", () => {
  it("検証した値を, 送られてきた項目だけ返す", async () => {
    // Act:
    const actual = await newProfileWorkflow().validateProfileUpdate({
      name: " たろう ",
    });

    // Assert:
    expect(unwrap(actual)).toEqual({ name: "たろう" });
  });
});

describe("validateSignUp", () => {
  const email = "4dde6d9e-55c0-4c17-ade9-06deb4dd224e@nwu.invalid";

  it("使い捨てのメールアドレスと正しい名前なら, 検証した値を返す", async () => {
    // Act:
    const actual = await newProfileWorkflow().validateSignUp({
      email,
      name: "ゲスト",
    });

    // Assert:
    expect(unwrap(actual)).toEqual({ name: "ゲスト" });
  });

  it("メールアドレスが違う場合, 名前より先にメールアドレスのエラーを返す", async () => {
    // Act:
    const actual = await newProfileWorkflow().validateSignUp({
      email: "someone@example.com",
      name: "",
    });

    // Assert:
    expect(unwrapErr(actual)).toMatchObject({
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
    const actual = await newProfileWorkflow().getDisplayUser({
      user: { id: "user1", name: "たろう", color: null, image: "javascript:x" },
    });

    // Assert:
    expect(unwrap(actual)).toEqual({
      name: "たろう",
      color: "#3cddb7",
      image: null,
    });
  });
});

// ----------------------------------------------------------------------------
// Step: バリデーション
// ----------------------------------------------------------------------------
describe("validateProfileInput", () => {
  it("名前の前後の空白を除く", () => {
    // Act:
    const actual = validateProfileInput({ name: "  たろう  " });

    // Assert:
    expect(unwrap(actual)).toEqual({
      type: "ValidatedProfile",
      name: "たろう",
    } as never);
  });

  it("送られてこなかった項目は含めない", () => {
    expect(unwrap(validateProfileInput({}))).toEqual({
      type: "ValidatedProfile",
    });
  });

  it("color の null は, イメージカラーを外す値として通す", () => {
    expect(unwrap(validateProfileInput({ color: null }))).toEqual({
      type: "ValidatedProfile",
      color: null,
    });
  });

  it("color は送られてきた値のまま (大文字も) 保存する", () => {
    expect<unknown>(
      unwrap(validateProfileInput({ color: "#AbCdEf" })).color,
    ).toBe("#AbCdEf");
  });

  it.each([
    ["空白だけ", "   "],
    ["31 文字", "a".repeat(31)],
    ["文字列でない", 1],
  ])("名前が%sの場合, ValidationError となる", (_, name) => {
    expect(unwrapErr(validateProfileInput({ name })).issues).toEqual({
      name: ["名前は 1〜30 文字で入力してください"],
    });
  });

  it("名前の文字数はコードポイントで数える (絵文字 30 個は通す)", () => {
    expect(isErr(validateProfileInput({ name: "🍣".repeat(30) }))).toBeFalse();
    expect(isErr(validateProfileInput({ name: "🍣".repeat(31) }))).toBeTrue();
  });

  it("名前は前後の空白を除いて 30 文字までなら通す", () => {
    expect(
      isErr(validateProfileInput({ name: ` ${"a".repeat(30)} ` })),
    ).toBeFalse();
  });

  it.each([
    ["#rgb", "#abc"],
    ["CSS に埋め込める別の値", "red;background:url(x)"],
  ])("color が %s の場合, ValidationError となる", (_, color) => {
    expect(unwrapErr(validateProfileInput({ color })).issues).toEqual({
      color: ["カラーコードは #rrggbb の形式で入力してください"],
    });
  });

  it("画像を設定しようとした場合, ValidationError となる", () => {
    expect(
      unwrapErr(
        validateProfileInput({
          image: "https://example.com/a.png",
        }),
      ).issues,
    ).toEqual({ image: ["画像は設定できません"] });
  });

  it("複数の誤りがある場合, すべてのエラーを名前・色・画像の順に返す", () => {
    // Act:
    const actual = validateProfileInput({ name: "", color: "x", image: "x" });

    // Assert:
    expect(Object.keys(unwrapErr(actual).issues)).toEqual([
      "name",
      "color",
      "image",
    ]);
  });
});

describe("validateSignupEmail", () => {
  it("ブラウザが作る <UUID>@nwu.invalid は通す", () => {
    expect(
      isErr(
        validateSignupEmail("4dde6d9e-55c0-4c17-ade9-06deb4dd224e@nwu.invalid"),
      ),
    ).toBeFalse();
  });

  it.each([
    ["普通のメールアドレス", "someone@example.com"],
    ["大文字の UUID", "4DDE6D9E-55C0-4C17-ADE9-06DEB4DD224E@nwu.invalid"],
    ["文字列でない", undefined],
  ])("%sの場合, ValidationError となる", (_, email) => {
    expect(unwrapErr(validateSignupEmail(email)).issues).toEqual({
      email: ["登録できません"],
    });
  });
});
