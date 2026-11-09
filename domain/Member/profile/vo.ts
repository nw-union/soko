import * as v from "valibot";
import { newVo } from "../../shared/vo.ts";
import { AVATAR_PREFIX, isAvatarKey, isHexColor, NAME_MAX } from "./rule.ts";

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
