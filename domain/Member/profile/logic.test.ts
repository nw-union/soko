import { describe, expect, it } from "bun:test";
import {
  ensurePasskeyDeletable,
  FRESH_AGE_SECONDS,
  resolveColor,
  resolveImage,
  validateImageFile,
  validateProfileInput,
  validateSignupEmail,
} from "./logic.ts";
import { AVATAR_MAX_BYTES } from "./rule.ts";
import { createAvatarKey, parseAvatarPath, toAvatarPath } from "./vo.ts";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const KEY = `${"ab".repeat(16)}.png`;

// ----------------------------------------------------------------------------
// vo.ts
// ----------------------------------------------------------------------------
describe("createAvatarKey / toAvatarPath / parseAvatarPath", () => {
  it("乱数を 32 桁の 16 進にし, 拡張子を付けたキーにする", () => {
    // Act:
    const actual = createAvatarKey(new Uint8Array(16).fill(0xab), "png");

    // Assert:
    expect<string>(actual).toBe(KEY);
  });

  it("キーとパスを行き来できる", () => {
    // Arrange:
    const key = createAvatarKey(new Uint8Array(16).fill(0xab), "png");

    // Act:
    const actual = parseAvatarPath(toAvatarPath(key));

    // Assert:
    expect<string | null>(actual).toBe(KEY);
  });

  it.each([
    ["外部の URL", "https://example.com/a.png"],
    ["パスの外を指す", `/files/avatars/../${KEY}`],
    ["空", null],
  ])("%s 場合, このアプリのアイコンとみなさない", (_, image) => {
    expect(parseAvatarPath(image)).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Domain Logic
// ----------------------------------------------------------------------------
describe("ensurePasskeyDeletable", () => {
  const now = new Date("2026-11-01T00:10:00Z");
  const fresh = new Date(now.getTime() - (FRESH_AGE_SECONDS - 1) * 1000);
  const stale = new Date(now.getTime() - FRESH_AGE_SECONDS * 1000);

  it("ログインし直したばかりで, パスキーが 2 つ以上あれば削除できる", () => {
    expect(ensurePasskeyDeletable(fresh, 2, now).isOk()).toBeTrue();
  });

  it("ログインから 10 分以上たっていれば, SESSION_NOT_FRESH の ForbiddenError となる", () => {
    // Act:
    const actual = ensurePasskeyDeletable(stale, 2, now);

    // Assert:
    expect(actual._unsafeUnwrapErr()).toEqual({
      type: "ForbiddenError",
      message: "Session is not fresh",
      code: "SESSION_NOT_FRESH",
    });
  });

  it("最後のパスキーは削除できない", () => {
    // Act:
    const actual = ensurePasskeyDeletable(fresh, 1, now);

    // Assert:
    expect(actual._unsafeUnwrapErr()).toMatchObject({
      type: "ValidationError",
      issues: {
        passkey: ["最後のパスキーは削除できません（ログインできなくなります）"],
      },
    });
  });
});

// ----------------------------------------------------------------------------
// Validater
// ----------------------------------------------------------------------------
describe("validateProfileInput", () => {
  it("名前の前後の空白を除く", () => {
    // Act:
    const actual = validateProfileInput({ name: "  たろう  " });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      type: "ValidatedProfile",
      name: "たろう",
    } as never);
  });

  it("送られてこなかった項目は含めない", () => {
    expect(validateProfileInput({})._unsafeUnwrap()).toEqual({
      type: "ValidatedProfile",
    });
  });

  it("color の null は, イメージカラーを外す値として通す", () => {
    expect(validateProfileInput({ color: null })._unsafeUnwrap()).toEqual({
      type: "ValidatedProfile",
      color: null,
    });
  });

  it("color は送られてきた値のまま (大文字も) 保存する", () => {
    expect<unknown>(
      validateProfileInput({ color: "#AbCdEf" })._unsafeUnwrap().color,
    ).toBe("#AbCdEf");
  });

  it.each([
    ["空白だけ", "   "],
    ["31 文字", "a".repeat(31)],
    ["文字列でない", 1],
  ])("名前が%sの場合, ValidationError となる", (_, name) => {
    expect(validateProfileInput({ name })._unsafeUnwrapErr().issues).toEqual({
      name: ["名前は 1〜30 文字で入力してください"],
    });
  });

  it("名前は前後の空白を除いて 30 文字までなら通す", () => {
    expect(
      validateProfileInput({ name: ` ${"a".repeat(30)} ` }).isOk(),
    ).toBeTrue();
  });

  it.each([
    ["#rgb", "#abc"],
    ["CSS に埋め込める別の値", "red;background:url(x)"],
  ])("color が %s の場合, ValidationError となる", (_, color) => {
    expect(validateProfileInput({ color })._unsafeUnwrapErr().issues).toEqual({
      color: ["カラーコードは #rrggbb の形式で入力してください"],
    });
  });

  it("画像を設定しようとした場合, ValidationError となる", () => {
    expect(
      validateProfileInput({
        image: "https://example.com/a.png",
      })._unsafeUnwrapErr().issues,
    ).toEqual({ image: ["画像は設定できません"] });
  });

  it("複数の誤りがある場合, すべてのエラーを名前・色・画像の順に返す", () => {
    // Act:
    const actual = validateProfileInput({ name: "", color: "x", image: "x" });

    // Assert:
    expect(Object.keys(actual._unsafeUnwrapErr().issues)).toEqual([
      "name",
      "color",
      "image",
    ]);
  });
});

describe("validateSignupEmail", () => {
  it("ブラウザが作る <UUID>@nwu.invalid は通す", () => {
    expect(
      validateSignupEmail(
        "4dde6d9e-55c0-4c17-ade9-06deb4dd224e@nwu.invalid",
      ).isOk(),
    ).toBeTrue();
  });

  it.each([
    ["普通のメールアドレス", "someone@example.com"],
    ["大文字の UUID", "4DDE6D9E-55C0-4C17-ADE9-06DEB4DD224E@nwu.invalid"],
    ["文字列でない", undefined],
  ])("%sの場合, ValidationError となる", (_, email) => {
    expect(validateSignupEmail(email)._unsafeUnwrapErr().issues).toEqual({
      email: ["登録できません"],
    });
  });
});

describe("validateImageFile", () => {
  it.each([
    ["PNG", PNG, "png", "image/png"],
    ["JPEG", JPEG, "jpg", "image/jpeg"],
    ["WebP", WEBP, "webp", "image/webp"],
  ])("%s の場合, 形式を判定する", (_, bytes, ext, contentType) => {
    expect(validateImageFile(bytes)._unsafeUnwrap()).toMatchObject({
      ext,
      contentType,
    });
  });

  it.each([
    ["ファイルがない", null, "画像を選んでください"],
    ["空", new Uint8Array(0), "画像は 2MB 以下にしてください"],
    [
      "2MB を超える",
      new Uint8Array(AVATAR_MAX_BYTES + 1),
      "画像は 2MB 以下にしてください",
    ],
    [
      "画像でない",
      new TextEncoder().encode("<svg></svg>"),
      "JPEG、PNG、WebP の画像を選んでください",
    ],
  ])("%s場合, ValidationError となる", (_, bytes, message) => {
    expect(validateImageFile(bytes)._unsafeUnwrapErr().issues).toEqual({
      file: [message],
    });
  });

  it("ちょうど 2MB なら通す", () => {
    // Arrange:
    const bytes = new Uint8Array(AVATAR_MAX_BYTES);
    bytes.set(PNG);

    // Act / Assert:
    expect(validateImageFile(bytes).isOk()).toBeTrue();
  });
});

// ----------------------------------------------------------------------------
// Converter
// ----------------------------------------------------------------------------
describe("resolveColor", () => {
  it("イメージカラーがあれば, 小文字にして使う", () => {
    expect(resolveColor("#AbCdEf", "user1")).toBe("#abcdef");
  });

  it.each([
    // 以前の実装 (src/lib/color.ts) で計算した値. 色が変わらないことを確かめる
    ["user1", "#3cddb7"],
    ["Bt7WuvDhIbRUCskh2aBknArKsBqAssOy", "#dd8a3c"],
    ["", "#dd3c3c"],
  ])("未設定なら, ユーザー ID (%s) から決まる色にする", (id, color) => {
    expect(resolveColor(null, id)).toBe(color);
  });

  it("不正な値なら, ユーザー ID から決まる色にする", () => {
    expect(resolveColor("red", "user1")).toBe("#3cddb7");
  });
});

describe("resolveImage", () => {
  it.each([
    ["このアプリのアイコン", `/files/avatars/${KEY}`],
    ["https の URL", "https://example.com/a.png"],
  ])("%s は, そのまま使う", (_, image) => {
    expect(resolveImage(image)).toBe(image);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["このアプリの別のパス", "/api/avatar"],
    ["空", null],
  ])("%s は使わない", (_, image) => {
    expect(resolveImage(image)).toBeNull();
  });
});
