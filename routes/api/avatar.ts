import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../server/container.ts";
import { errorResponse } from "../../server/http/error.ts";

// アイコン画像をアップロードする（multipart の "file"）。ブラウザ（ProfileSheet.svelte）が切り抜き・縮小したものが届く
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  return container()
    .memberWorkFlows.changeAvatar({
      userId: user.id,
      file:
        file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null,
    })
    .match(
      (evt) => evt,
      (e) => errorResponse(c, e),
    );
});

// アイコン画像を外して、頭文字の表示に戻す
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  return container()
    .memberWorkFlows.removeAvatar({ userId: user.id })
    .match(
      () => null,
      (e) => errorResponse(c, e),
    );
});
