// アイコン画像の配信（R2 のオブジェクトをそのまま返す）。ビジネスロジックはないので WorkFlow にはしない
import { storage } from "void/storage";
import { avatarObjectKey } from "../adapter/r2/avatar.ts";
import { isAvatarKey } from "../domain/Profile/rule.ts";

/**
 * アイコン画像の応答. キーの形が違うか, 画像がなければ null
 *
 * キーはランダムで, 差し替えると別のキーになるので, ずっとキャッシュしてよい
 */
export const avatarResponse = async (key: string | undefined) => {
  if (!key || !isAvatarKey(key)) return null;
  const object = await storage.get(avatarObjectKey(key));
  if (!object) return null;

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  // アップロードされたファイルが、ページとして実行されないように
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
};
