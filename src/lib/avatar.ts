// アイコン画像（R2 に保存し、/files/avatars/<キー> で配信する）。
// user.image にはこのパスを入れる。キーはサーバーが決めるランダムな名前で、URL を知らない人は辿り着けない
export const AVATAR_PREFIX = "/files/avatars/";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
// ブラウザ側で切り抜いて縮小する一辺の長さ（px）
export const AVATAR_SIZE = 512;

// キーは 32 桁の小文字 16 進 + 拡張子
const AVATAR_KEY = /^[0-9a-f]{32}\.(jpg|png|webp)$/;

export const isAvatarKey = (key: string) => AVATAR_KEY.test(key);

// user.image が、このアプリで保存したアイコンのパスか
export const isAvatarPath = (value: string) =>
  value.startsWith(AVATAR_PREFIX) &&
  isAvatarKey(value.slice(AVATAR_PREFIX.length));

export const avatarObjectKey = (key: string) => `avatars/${key}`;

// ファイルの先頭のバイト列から形式を判定する（申告された Content-Type は信用しない）
export function sniffImage(
  bytes: Uint8Array,
): { ext: "jpg" | "png" | "webp"; type: string } | null {
  const at = (i: number, ...v: number[]) =>
    v.every((b, k) => bytes[i + k] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return { ext: "jpg", type: "image/jpeg" };
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return { ext: "png", type: "image/png" };
  // "RIFF" ???? "WEBP"
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
    return { ext: "webp", type: "image/webp" };
  return null;
}
