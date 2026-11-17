import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  createAvatarKey,
  createInviteToken,
  createTokenHash,
  newInviteToken,
  parseAvatarPath,
  TOKEN_ALPHABET,
  toAvatarPath,
} from "./vo.ts";

export const mustInviteToken = (s: string) => newInviteToken(s)._unsafeUnwrap();

const TOKEN = "ABCDEFGHJKMNPQRS";

const KEY = `${"ab".repeat(16)}.png`;

// ----------------------------------------------------------------------------
// vo.ts
// ----------------------------------------------------------------------------
describe("createInviteToken", () => {
  it("乱数の各バイトを, 紛らわしい文字を除いた 31 文字に割り当てる", () => {
    // Arrange: 0, 1, ..., 30, 31 (31 は 0 番目に戻る)
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i * 2);

    // Act:
    const actual = createInviteToken(bytes);

    // Assert:
    expect<string>(actual).toBe(
      Array.from(bytes, (b) => TOKEN_ALPHABET[b % 31]).join(""),
    );
  });

  it("どんな乱数でも, 16 文字の有効なトークンになる", () => {
    // Arrange:
    const bytes = new Uint8Array(16).fill(255);

    // Act:
    const actual = createInviteToken(bytes);

    // Assert:
    expect(newInviteToken(actual).isOk()).toBeTrue();
  });
});

describe("createTokenHash", () => {
  it("SHA-256 の小文字 16 進になる (既に保存されているハッシュ・scripts/create-invite.mjs と同じ)", async () => {
    // Act:
    const actual = await createTokenHash(mustInviteToken(TOKEN));

    // Assert:
    expect<string>(actual).toBe(
      createHash("sha256").update(TOKEN).digest("hex"),
    );
  });
});

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
