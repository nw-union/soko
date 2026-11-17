import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../../../server/container.ts";
import { respond } from "../../../../server/http/error.ts";

// プレイリストを消す
export const DELETE = defineHandler(async (c) => {
  requireAuth(c);
  return respond(
    c,
    container().contentUsecase.deletePlaylist({ id: c.req.param("id") ?? "" }),
    () => null,
  );
});
