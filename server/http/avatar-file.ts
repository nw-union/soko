// アイコン画像の配信の応答. 中身は Query (memberQueries.getAvatarFile) で読み, ここでは HTTP の応答にするだけ
import type { AvatarFileView } from "../../domain/Member/api.ts";

/**
 * アイコン画像の応答
 *
 * キーはランダムで, 差し替えると別のキーになるので, ずっとキャッシュしてよい
 */
export const avatarResponse = (file: AvatarFileView): Response => {
  const headers = new Headers();
  if (file.contentType) headers.set("Content-Type", file.contentType);
  headers.set("etag", file.etag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  // アップロードされたファイルが、ページとして実行されないように
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(file.body, { headers });
};
