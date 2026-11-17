import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../../server/container.ts";
import { respond } from "../../../server/http/error.ts";

// 動画の概要欄。ホームの HTML には含めず、再生画面を開いたときにブラウザ（pages/index.svelte）が取りに来る。
// 限定公開の動画もあるので、ログインした人だけに返す
export const GET = defineHandler(async (c) => {
  requireAuth(c);
  return respond(
    c,
    container().contentUsecase.getVideoDetail({
      youtubeId: c.req.param("youtubeId"),
    }),
    (view) => view,
  );
});
