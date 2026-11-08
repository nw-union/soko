import { asc, desc, eq, inArray, sql } from "void/db";
// auth.ts から読み込まれるので、Vite のエイリアス（@schema）ではなく相対パスで読む（Void の CLI はエイリアスを解決できない）
import {
  playlists,
  playlistVideos,
  videos,
  videoWatches,
} from "../../db/schema.ts";
import type { FeedRepositoryPort } from "../../domain/Content/feed/port.ts";
import type { StoredVideo } from "../../domain/Content/feed/type.ts";
import { type Database, query } from "./util.ts";

// ----------------------------------------------------------------------------
// Validater (Table -> Domain Type)
// ----------------------------------------------------------------------------
/**
 * tags は JSON 配列の文字列. 壊れていても画面は落とさず, タグなしにする
 */
export const parseTags = (json: string): string[] => {
  try {
    const tags: unknown = JSON.parse(json);
    return Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
};

const toStoredVideo = (row: typeof videos.$inferSelect): StoredVideo => ({
  type: "StoredVideo",
  id: row.id,
  youtubeId: row.youtubeId,
  title: row.title,
  description: row.description,
  durationSeconds: row.durationSeconds,
  aspectRatio: row.aspectRatio,
  publishedAt: row.publishedAt,
  tags: parseTags(row.tags),
});

// ----------------------------------------------------------------------------
// Repository
// ----------------------------------------------------------------------------
export const newFeedRepository = (db: Database): FeedRepositoryPort => ({
  listPlaylists: () =>
    query("listPlaylists", () =>
      db
        .select()
        .from(playlists)
        .orderBy(asc(playlists.position), asc(playlists.id)),
    ).map((rows) =>
      rows.map((list) => ({
        type: "Playlist" as const,
        id: list.id,
        name: list.name,
        description: list.description,
      })),
    ),

  listPlaylistVideos: () =>
    query("listPlaylistVideos", () =>
      db
        .select({ playlistId: playlistVideos.playlistId, video: videos })
        .from(playlistVideos)
        .innerJoin(videos, eq(videos.id, playlistVideos.videoId))
        .orderBy(desc(videos.publishedAt), asc(videos.id)),
    ).map((rows) =>
      rows.map((row) => ({
        playlistId: row.playlistId,
        video: toStoredVideo(row.video),
      })),
    ),

  listPlaylistVideoDates: () =>
    query("listPlaylistVideoDates", () =>
      db.all<{ youtube_id: string; published_at: string | null }>(sql`
        SELECT youtube_id, published_at FROM videos
        WHERE id IN (SELECT video_id FROM playlist_videos)`),
    ).map((rows) =>
      rows.map((row) => ({
        youtubeId: row.youtube_id,
        publishedAt: row.published_at,
      })),
    ),

  listWatchedIds: (user) =>
    query("listWatchedIds", () =>
      db
        .select({ youtubeId: videoWatches.youtubeId })
        .from(videoWatches)
        .where(eq(videoWatches.userId, user)),
    ).map((rows) => rows.map((row) => row.youtubeId)),

  listWatches: (users) =>
    query("listWatches", () =>
      db
        .select({
          userId: videoWatches.userId,
          youtubeId: videoWatches.youtubeId,
        })
        .from(videoWatches)
        .where(inArray(videoWatches.userId, users)),
    ),

  // user テーブルは better-auth の管理で, createdAt はミリ秒の整数
  listMembers: (users) =>
    query("listMembers", () =>
      db.all<{ id: string; createdAt: number }>(
        sql`SELECT id, createdAt FROM user WHERE id IN (${sql.join(
          users.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    ).map((rows) =>
      rows.map((row) => ({
        id: row.id as (typeof users)[number],
        joinedAt: new Date(row.createdAt),
      })),
    ),

  insertWatch: (user, youtubeId) =>
    query("insertWatch", () =>
      db.run(sql`
        INSERT INTO video_watches (user_id, youtube_id)
        SELECT ${user}, youtube_id FROM videos WHERE youtube_id = ${youtubeId}
        ON CONFLICT DO NOTHING`),
    ).map(() => undefined),

  deleteWatch: (user, youtubeId) =>
    query("deleteWatch", () =>
      db.run(
        sql`DELETE FROM video_watches WHERE user_id = ${user} AND youtube_id = ${youtubeId}`,
      ),
    ).map(() => undefined),
});
