import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../../../server/container.ts";
import { errorResponse } from "../../../../server/http/error.ts";

// プレイリストを消す
export const DELETE = defineHandler(async (c) => {
  requireAuth(c);
  return container()
    .contentWorkFlows.deletePlaylist({ id: Number(c.req.param("id")) })
    .match(
      () => null,
      (e) => errorResponse(c, e),
    );
});
