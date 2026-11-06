import { defineHandler } from "void";
import { storage } from "void/storage";
import { avatarObjectKey } from "../../../adapter/r2/avatar.ts";
import { isAvatarKey } from "../../../domain/Profile/rule.ts";

// アイコン画像の配信。キーはランダムで、差し替えると別のキーになるので、ずっとキャッシュしてよい
export const GET = defineHandler(async (c) => {
  const key = c.req.param("key");
  if (!key || !isAvatarKey(key)) return c.notFound();
  const object = await storage.get(avatarObjectKey(key));
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  // アップロードされたファイルが、ページとして実行されないように
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
});
