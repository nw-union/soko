import { defineScheduled } from "void";
import { db, sql } from "void/db";
import { env } from "void/env";
import { videos } from "@schema";
import { fetchPlaylistVideoIds, fetchVideos } from "../src/lib/youtube-api";

// 6 時間ごとに、プレイリストの動画を videos に反映する
export const cron = "0 */6 * * *";

export default defineScheduled(async () => {
  const key = env.YOUTUBE_API_KEY;
  const playlistId = env.YOUTUBE_PLAYLIST_ID;
  if (!key || !playlistId) {
    console.warn("sync-videos: YOUTUBE_API_KEY / YOUTUBE_PLAYLIST_ID が未設定のため、取得をスキップします");
    return;
  }

  // 手動で登録済みの動画も一緒に引いて、タイトル・長さ・投稿日時を最新にする
  const existing = await db.select({ youtubeId: videos.youtubeId }).from(videos);
  const ids = [...new Set([...(await fetchPlaylistVideoIds(playlistId, key)), ...existing.map((row) => row.youtubeId)])];
  const fetched = await fetchVideos(ids, key);

  // position は手動の並び替え用なので、更新では触らない（新規は既定の 0）
  for (let i = 0; i < fetched.length; i += 10) {
    await db
      .insert(videos)
      .values(fetched.slice(i, i + 10).map(({ tags, ...video }) => ({ ...video, tags: JSON.stringify(tags) })))
      .onConflictDoUpdate({
        target: videos.youtubeId,
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          durationSeconds: sql`excluded.duration_seconds`,
          publishedAt: sql`excluded.published_at`,
          tags: sql`excluded.tags`,
        },
      });
  }
  console.log(`sync-videos: ${fetched.length} 件を反映しました`);
});
