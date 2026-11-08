import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mustUserId } from "../../vo.test.ts";
import {
  createNewInvite,
  DEFAULT_INVITE_LIMIT,
  ensureIssued,
  ensureUsable,
  formatToken,
  limitOf,
  normalizeToken,
  remainingOf,
  validateInviteId,
  validateToken,
} from "./logic.ts";
import type { InviteUsage } from "./type.ts";
import {
  createInviteToken,
  createTokenHash,
  newInviteToken,
  TOKEN_ALPHABET,
} from "./vo.ts";

export const mustInviteToken = (s: string) => newInviteToken(s)._unsafeUnwrap();

const TOKEN = "ABCDEFGHJKMNPQRS";
const usage = (limit: number | null, used: number): InviteUsage => ({
  type: "InviteUsage",
  limit,
  used,
});

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

// ----------------------------------------------------------------------------
// Domain Logic
// ----------------------------------------------------------------------------
describe("createNewInvite", () => {
  it("期限は発行から 7 日後になる", () => {
    // Arrange:
    const now = new Date("2026-11-01T00:00:00Z");

    // Act:
    const actual = createNewInvite(
      mustInviteToken(TOKEN),
      "0".repeat(64) as never,
      mustUserId("user1"),
      now,
    );

    // Assert:
    expect(actual.expiresAt.toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });
});

describe("limitOf / remainingOf", () => {
  it("user.inviteLimit がなければ, 初期値を上限にする", () => {
    expect(limitOf(usage(null, 0))).toBe(DEFAULT_INVITE_LIMIT);
  });

  it("user.inviteLimit があれば, それを上限にする", () => {
    expect(limitOf(usage(10, 0))).toBe(10);
  });

  it("残りは, 上限から数える招待の数を引いたもの", () => {
    expect(remainingOf(usage(5, 2))).toBe(3);
  });

  it("上限を下げて使った数の方が多くなっても, 残りは 0 になる", () => {
    expect(remainingOf(usage(1, 3))).toBe(0);
  });
});

describe("ensureIssued", () => {
  it("保存できなかった場合, 上限に達した ConflictError となる", () => {
    // Act:
    const actual = ensureIssued(false);

    // Assert:
    expect(actual._unsafeUnwrapErr()).toEqual({
      type: "ConflictError",
      message: "招待の発行上限に達しています",
    });
  });

  it("保存できた場合, 成功となる", () => {
    expect(ensureIssued(true).isOk()).toBeTrue();
  });
});

describe("ensureUsable", () => {
  it("使えなかった場合, 理由を教えない ValidationError となる", () => {
    // Act:
    const actual = ensureUsable(false);

    // Assert:
    expect(actual._unsafeUnwrapErr().issues).toEqual({
      token: ["招待コードが正しくないか、期限切れです"],
    });
  });
});

// ----------------------------------------------------------------------------
// Validater
// ----------------------------------------------------------------------------
describe("normalizeToken", () => {
  it("小文字・ハイフン・空白を無視する", () => {
    expect(normalizeToken(" abcd-efgh jkmn-pqrs ")).toBe(TOKEN);
  });
});

describe("validateToken", () => {
  it("画面に出す形 (ハイフン区切り・小文字) でも, 正規化して InviteToken になる", () => {
    // Act:
    const actual = validateToken("abcd-efgh-jkmn-pqrs");

    // Assert:
    expect<string>(actual._unsafeUnwrap()).toBe(TOKEN);
  });

  it.each([
    ["短い", "ABCD-EFGH-JKMN"],
    ["長い", "ABCD-EFGH-JKMN-PQRS-T"],
    ["使わない文字 (O) を含む", "ABCD-EFGH-JKMN-PQRO"],
    ["文字列でない", 1234],
    ["空", undefined],
  ])("%s 場合, 理由を教えない ValidationError となる", (_, input) => {
    // Act:
    const actual = validateToken(input);

    // Assert:
    expect(actual._unsafeUnwrapErr().issues).toEqual({
      token: ["招待コードが正しくないか、期限切れです"],
    });
  });
});

describe("validateInviteId", () => {
  it("整数の文字列の場合, InviteId になる", () => {
    expect<number>(validateInviteId("12")._unsafeUnwrap()).toBe(12);
  });

  it.each([
    ["数値でない", "abc"],
    ["小数", "1.5"],
    ["ない", undefined],
  ])("%s場合, ValidationError となる", (_, input) => {
    // Act:
    const actual = validateInviteId(input);

    // Assert:
    expect(actual._unsafeUnwrapErr().issues).toEqual({
      id: ["id が正しくありません"],
    });
  });
});

// ----------------------------------------------------------------------------
// Converter
// ----------------------------------------------------------------------------
describe("formatToken", () => {
  it("4 文字ごとにハイフンで区切る", () => {
    expect(formatToken(mustInviteToken(TOKEN))).toBe("ABCD-EFGH-JKMN-PQRS");
  });
});
