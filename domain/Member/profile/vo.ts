import { match } from "@nw-union/nw-utils/lib/match";
import { type InferVo, v } from "@nw-union/nw-utils/lib/vo";
import { check, mustVo, newVo, trim } from "../../shared/vo.ts";
import { AVATAR_PREFIX, isAvatarKey, isHexColor, NAME_MAX } from "./rule.ts";

/**
 * UserName 名前 (前後の空白を除いて 1〜NAME_MAX 文字)
 */
export const newUserName = newVo(
  "UserName",
  v.chain(
    v.string,
    trim,
    v.minLength(1),
    // 文字数はコードポイントで数える (絵文字 1 つで 1 文字). v.maxLength は UTF-16 の長さで数えるので使わない
    check((s: string) => [...s].length <= NAME_MAX),
  ),
);
export type UserName = InferVo<typeof newUserName>;

/**
 * HexColor イメージカラー (#rrggbb)
 */
export const newHexColor = newVo(
  "HexColor",
  v.chain(v.string, check<string>(isHexColor)),
);
export type HexColor = InferVo<typeof newHexColor>;

/**
 * AvatarKey アイコン画像のキー (32 桁の小文字 16 進 + 拡張子)
 */
export const newAvatarKey = newVo(
  "AvatarKey",
  v.chain(v.string, check(isAvatarKey)),
);
export type AvatarKey = InferVo<typeof newAvatarKey>;

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
  mustVo(
    newAvatarKey(
      `${[...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}.${ext}`,
    ),
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
  return match(newAvatarKey(image.slice(AVATAR_PREFIX.length)))
    .ok((key) => key)
    .err(() => null)
    .exhaustive();
};
