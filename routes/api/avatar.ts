import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { db, sql } from "void/db";
import { storage } from "void/storage";
import {
  AVATAR_MAX_BYTES,
  AVATAR_PREFIX,
  avatarObjectKey,
  isAvatarPath,
  sniffImage,
} from "../../src/lib/avatar";

// 古い画像を R2 から消す。失敗しても、アイコンの変更そのものは成功させる
async function removeOld(image: string | null | undefined) {
  if (!image || !isAvatarPath(image)) return;
  await storage
    .delete(avatarObjectKey(image.slice(AVATAR_PREFIX.length)))
    .catch(() => {});
}

const currentImage = async (userId: string) =>
  (
    await db.all<{ image: string | null }>(
      sql`SELECT image FROM user WHERE id = ${userId}`,
    )
  )[0]?.image;

// アイコン画像をアップロードする（multipart の "file"）。ブラウザ（ProfileSheet.svelte）が切り抜き・縮小したものが届く
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return c.json({ message: "画像を選んでください" }, 400);
  if (file.size === 0 || file.size > AVATAR_MAX_BYTES)
    return c.json({ message: "画像は 2MB 以下にしてください" }, 413);

  const data = await file.arrayBuffer();
  const kind = sniffImage(new Uint8Array(data, 0, 12));
  if (!kind)
    return c.json({ message: "JPEG、PNG、WebP の画像を選んでください" }, 415);

  const key = `${crypto.randomUUID().replaceAll("-", "")}.${kind.ext}`;
  await storage.put(avatarObjectKey(key), data, {
    httpMetadata: { contentType: kind.type },
  });

  const old = await currentImage(user.id);
  const image = `${AVATAR_PREFIX}${key}`;
  await db.run(
    sql`UPDATE user SET image = ${image}, updatedAt = ${Date.now()} WHERE id = ${user.id}`,
  );
  await removeOld(old);
  return { image };
});

// アイコン画像を外して、頭文字の表示に戻す
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  const old = await currentImage(user.id);
  await db.run(
    sql`UPDATE user SET image = NULL, updatedAt = ${Date.now()} WHERE id = ${user.id}`,
  );
  await removeOld(old);
  return null;
});
