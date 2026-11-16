// プロフィールの定数と判定のうち、ブラウザ（入力欄の制限・その場の検証）からも使うもの。
// ブラウザのバンドルに valibot を入れないよう、このファイルは何にも依存させない（valibot を使う VO は vo.ts）

/**
 * 名前の長さの上限 (前後の空白を除いた文字数)
 */
export const NAME_MAX = 30;

/**
 * 登録の直後, /welcome で名前を決めるまでの仮の名前
 */
export const GUEST_NAME = "ゲスト";

/**
 * イメージカラー (#rrggbb). 値は style 属性に埋め込むので, 必ずこの検証を通ったものだけを使う
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && HEX_COLOR.test(value);

/**
 * アイコン画像. R2 に保存し, /files/avatars/<キー> で配信する.
 * user.image にはこのパスを入れる. キーはサーバーが決めるランダムな名前で, URL を知らない人は辿り着けない
 */
export const AVATAR_PREFIX = "/files/avatars/";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
// ブラウザ側で切り抜いて縮小する一辺の長さ (px)
export const AVATAR_SIZE = 512;

// キーは 32 桁の小文字 16 進 + 拡張子
const AVATAR_KEY = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
export const isAvatarKey = (key: string): boolean => AVATAR_KEY.test(key);

/**
 * user.image が, このアプリで保存したアイコンのパスか
 */
export const isAvatarPath = (value: string): boolean =>
  value.startsWith(AVATAR_PREFIX) &&
  isAvatarKey(value.slice(AVATAR_PREFIX.length));
