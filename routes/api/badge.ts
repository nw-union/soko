import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../server/container.ts";
import { errorResponse } from "../../server/http.ts";

// アプリのアイコンのバッジに出す、未視聴の New の本数。ブラウザ（src/lib/push.ts）が取りに来る
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c);
  return container()
    .contentQueries.getBadgeCount({ userId: user.id })
    .match(
      (evt) => evt,
      (e) => errorResponse(c, e),
    );
});
