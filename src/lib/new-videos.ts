// New の動画の判定と、未視聴の件数（サーバー用）。件数はアプリのアイコンのバッジに出す。

import { videoWatches } from "@schema";
import { db, inArray, sql } from "void/db";
import { isYoutubeId } from "./youtube";

// New は、登録より後に投稿された動画（投稿日時のない動画は NaN で入らない）
export const isNewVideo = (publishedAt: string | null, joinedAt: number) =>
  Date.parse(publishedAt ?? "") >= joinedAt;

// ユーザーごとの、未視聴の New の本数。トップページと同じく、プレイリストに入っている動画だけを数える。
// 画面は New を並べる本数を絞っているが、バッジは未視聴をすべて数える
export const unwatchedNewCounts = async (userIds: string[]) => {
  const counts = new Map<string, number>();
  if (userIds.length === 0) return counts;

  const placeholders = sql.join(
    userIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const [users, videos, watches] = await Promise.all([
    // createdAt はミリ秒の整数
    db.all<{ id: string; createdAt: number }>(
      sql`SELECT id, createdAt FROM user WHERE id IN (${placeholders})`,
    ),
    db.all<{ youtube_id: string; published_at: string | null }>(sql`
      SELECT youtube_id, published_at FROM videos
      WHERE id IN (SELECT video_id FROM playlist_videos)`),
    db
      .select({
        userId: videoWatches.userId,
        youtubeId: videoWatches.youtubeId,
      })
      .from(videoWatches)
      .where(inArray(videoWatches.userId, userIds)),
  ]);

  const watched = new Set(watches.map((w) => `${w.userId}:${w.youtubeId}`));
  for (const user of users) {
    counts.set(
      user.id,
      videos.filter(
        (video) =>
          isYoutubeId(video.youtube_id) &&
          isNewVideo(video.published_at, user.createdAt) &&
          !watched.has(`${user.id}:${video.youtube_id}`),
      ).length,
    );
  }
  return counts;
};
