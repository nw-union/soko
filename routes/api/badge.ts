import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { unwatchedNewCounts } from "../../src/lib/new-videos";

// アプリのアイコンのバッジに出す、未視聴の New の本数。ブラウザ（src/lib/push.ts）が取りに来る
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c);
  const counts = await unwatchedNewCounts([user.id]);
  return { count: counts.get(user.id) ?? 0 };
});
