import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../server/container.ts";
import { respond } from "../../server/http/error.ts";

// アイコン画像をアップロードする（multipart の "file"）。ブラウザ（ProfileSheet.svelte）が切り抜き・縮小したものが届く
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  return respond(
    c,
    container().memberUsecase.changeAvatar({
      userId: user.id,
      file:
        file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null,
    }),
    (evt) => evt,
  );
});

// アイコン画像を外して、頭文字の表示に戻す
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  return respond(
    c,
    container().memberUsecase.removeAvatar({ userId: user.id }),
    () => null,
  );
});
