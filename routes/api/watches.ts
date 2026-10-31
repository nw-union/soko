import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { db, sql } from "void/db";
import { isYoutubeId } from "../../src/lib/youtube";

// 動画を見たことを記録する。再生が始まったとき・YouTube で開いたときに、ブラウザ（pages/index.svelte）が送る。
// 登録済みの動画だけを受け付け、同じ動画を何度送っても 1 行のまま（最初に見た日時が残る）
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const body = (await c.req.json().catch(() => null)) as {
    youtubeId?: unknown;
  } | null;
  const youtubeId = body?.youtubeId;
  if (typeof youtubeId !== "string" || !isYoutubeId(youtubeId))
    return c.json({ message: "動画の指定が正しくありません" }, 400);
  await db.run(sql`
    INSERT INTO video_watches (user_id, youtube_id)
    SELECT ${user.id}, youtube_id FROM videos WHERE youtube_id = ${youtubeId}
    ON CONFLICT DO NOTHING`);
  return null;
});

// 視聴記録を消して、未視聴に戻す
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  const youtubeId = c.req.query("youtubeId");
  if (!youtubeId || !isYoutubeId(youtubeId))
    return c.json({ message: "動画の指定が正しくありません" }, 400);
  await db.run(
    sql`DELETE FROM video_watches WHERE user_id = ${user.id} AND youtube_id = ${youtubeId}`,
  );
  return null;
});
