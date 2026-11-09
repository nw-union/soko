import { z } from "zod";
import { newVo } from "../../shared/vo.ts";

/**
 * トークンに使う文字. 紛らわしい文字 (0 O 1 I L) を除いた 31 文字. 16 文字で約 80 ビット
 */
export const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TOKEN_LENGTH = 16;

/**
 * InviteToken 招待トークン (正規化済み: 大文字・ハイフンなし)
 *
 * DB には保存しない. 発行した本人に 1 回だけ見せる
 */
const inviteToken = z
  .string()
  .regex(new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`))
  .brand("InviteToken");
export type InviteToken = z.infer<typeof inviteToken>;
export const newInviteToken = newVo(inviteToken, "InviteToken");

/**
 * 招待トークンを作る
 *
 * @param bytes - 暗号論的に安全な乱数 (TOKEN_LENGTH バイト)
 */
export const createInviteToken = (bytes: Uint8Array): InviteToken =>
  inviteToken.parse(
    // 256 % 31 の偏りは 16 文字・約 80 ビットでは無視できる
    Array.from(
      bytes.slice(0, TOKEN_LENGTH),
      (byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length],
    ).join(""),
  );

/**
 * TokenHash 招待トークンの SHA-256 (小文字 16 進 64 文字)
 *
 * DB にはトークンそのものではなく, これだけを保存する (DB が見られても使えないように)
 */
const tokenHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand("TokenHash");
export type TokenHash = z.infer<typeof tokenHash>;

export const createTokenHash = async (
  token: InviteToken,
): Promise<TokenHash> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return tokenHash.parse(
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );
};

/**
 * InviteId 招待の ID (invites.id)
 *
 * クエリ文字列から来るので, 数値に変換してから整数か確かめる
 */
const inviteId = z.coerce.number().int().brand("InviteId");
export type InviteId = z.infer<typeof inviteId>;
export const newInviteId = newVo(inviteId, "InviteId");
