import { z } from "zod";
import { newVo } from "../vo.ts";
import { AVATAR_PREFIX, isAvatarKey, isHexColor, NAME_MAX } from "./rule.ts";

/**
 * UserName 名前 (前後の空白を除いて 1〜NAME_MAX 文字)
 */
const userName = z.string().trim().min(1).max(NAME_MAX).brand("UserName");
export type UserName = z.infer<typeof userName>;
export const newUserName = newVo(userName, "UserName");

/**
 * HexColor イメージカラー (#rrggbb)
 */
const hexColor = z.string().refine(isHexColor).brand("HexColor");
export type HexColor = z.infer<typeof hexColor>;
export const newHexColor = newVo(hexColor, "HexColor");

/**
 * AvatarKey アイコン画像のキー (32 桁の小文字 16 進 + 拡張子)
 */
const avatarKey = z.string().refine(isAvatarKey).brand("AvatarKey");
export type AvatarKey = z.infer<typeof avatarKey>;

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
  avatarKey.parse(
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
  const r = avatarKey.safeParse(image.slice(AVATAR_PREFIX.length));
  return r.success ? r.data : null;
};
