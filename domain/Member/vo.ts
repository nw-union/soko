import * as v from "valibot";
import { newVo } from "../shared/vo.ts";
import { AVATAR_PREFIX, isAvatarKey, isHexColor, NAME_MAX } from "./rule.ts";

// ----------------------------------------------------------------------------
// 招待
// ----------------------------------------------------------------------------
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
const inviteToken = v.pipe(
  v.string(),
  v.regex(new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`)),
  v.brand("InviteToken"),
);
export type InviteToken = v.InferOutput<typeof inviteToken>;
export const newInviteToken = newVo(inviteToken, "InviteToken");

/**
 * 招待トークンを作る
 *
 * @param bytes - 暗号論的に安全な乱数 (TOKEN_LENGTH バイト)
 */
export const createInviteToken = (bytes: Uint8Array): InviteToken =>
  v.parse(
    inviteToken,
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
const tokenHash = v.pipe(
  v.string(),
  v.regex(/^[0-9a-f]{64}$/),
  v.brand("TokenHash"),
);
export type TokenHash = v.InferOutput<typeof tokenHash>;

export const createTokenHash = async (
  token: InviteToken,
): Promise<TokenHash> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return v.parse(
    tokenHash,
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
// クエリ文字列のまま受け取るので, 数値に変換してから確かめる
const inviteId = v.pipe(
  v.unknown(),
  v.transform(Number),
  v.number(),
  v.safeInteger(),
  v.brand("InviteId"),
);
export type InviteId = v.InferOutput<typeof inviteId>;
export const newInviteId = newVo(inviteId, "InviteId");

// ----------------------------------------------------------------------------
// プロフィール・アイコン画像
// ----------------------------------------------------------------------------
/**
 * UserName 名前 (前後の空白を除いて 1〜NAME_MAX 文字)
 */
const userName = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1),
  // 文字数はコードポイントで数える (絵文字 1 つで 1 文字). v.maxLength は UTF-16 の長さで数えるので使わない
  v.check((s) => [...s].length <= NAME_MAX),
  v.brand("UserName"),
);
export type UserName = v.InferOutput<typeof userName>;
export const newUserName = newVo(userName, "UserName");

/**
 * HexColor イメージカラー (#rrggbb)
 */
const hexColor = v.pipe(
  v.string(),
  v.check((s: string) => isHexColor(s)),
  v.brand("HexColor"),
);
export type HexColor = v.InferOutput<typeof hexColor>;
export const newHexColor = newVo(hexColor, "HexColor");

/**
 * AvatarKey アイコン画像のキー (32 桁の小文字 16 進 + 拡張子)
 */
const avatarKey = v.pipe(
  v.string(),
  v.check(isAvatarKey),
  v.brand("AvatarKey"),
);
export type AvatarKey = v.InferOutput<typeof avatarKey>;
export const newAvatarKey = newVo(avatarKey, "AvatarKey");

/**
 * アイコン画像のキーを作る
 *
 * @param bytes - 暗号論的に安全な乱数 (16 バイト)
 * @param ext - 画像の拡張子
 */
export const createAvatarKey = (
  bytes: Uint8Array,
  ext: "jpg" | "png" | "webp",
): AvatarKey =>
  v.parse(
    avatarKey,
    `${[...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}.${ext}`,
  );

/**
 * user.image に入れるパスにする
 */
export const toAvatarPath = (key: AvatarKey): string =>
  `${AVATAR_PREFIX}${key}`;

/**
 * user.image が, このアプリで保存したアイコンのパスなら, そのキーを返す
 */
export const parseAvatarPath = (image: unknown): AvatarKey | null => {
  if (typeof image !== "string" || !image.startsWith(AVATAR_PREFIX))
    return null;
  const r = v.safeParse(avatarKey, image.slice(AVATAR_PREFIX.length));
  return r.success ? r.output : null;
};
