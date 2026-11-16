import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../server/container.ts";
import { respond } from "../../server/http/error.ts";

// アプリのアイコンのバッジに出す、未視聴の New の本数。ブラウザ（src/lib/client/push.ts）が取りに来る
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c);
  return respond(
    c,
    container().contentUsecase.getBadgeCount({ userId: user.id }),
    (evt) => evt,
  );
});
