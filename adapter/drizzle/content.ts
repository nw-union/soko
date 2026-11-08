import { asc, desc, eq, inArray, sql } from "void/db";
// auth.ts から読み込まれるので、Vite のエイリアス（@schema）ではなく相対パスで読む（Void の CLI はエイリアスを解決できない）
import {
  playlists,
  playlistVideos,
  videos,
  videoWatches,
} from "../../db/schema.ts";
import type { ContentRepositoryPort } from "../../domain/Content/port.ts";
import type { FetchedVideo, StoredVideo } from "../../domain/Content/type.ts";
import { type Database, query } from "./util.ts";

// D1 は 1 文のバインド変数が 100 個までなので, まとめて渡すときは分ける
export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
};

// videos に入れる形. tags は JSON 配列の文字列にする
const toVideoRow = ({ tags, ...video }: FetchedVideo) => ({
  ...video,
  tags: JSON.stringify(tags),
});

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
export const newContentRepository = (db: Database): ContentRepositoryPort => ({
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
        playlistId: list.playlistId,
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

  // ---- プレイリストの管理 ----

  insertPlaylist: (id) =>
    query("insertPlaylist", () =>
      db
        .insert(playlists)
        .values({ playlistId: id })
        .onConflictDoNothing()
        .returning(),
    ).map((rows) => {
      const list = rows[0];
      return list
        ? {
            type: "Playlist" as const,
            id: list.id,
            playlistId: list.playlistId,
            name: list.name,
            description: list.description,
          }
        : null;
    }),

  deletePlaylist: (id) =>
    query("deletePlaylist", () =>
      db.delete(playlists).where(eq(playlists.id, id)),
    ).map(() => undefined),

  // ---- YouTube からの取り込み ----

  updatePlaylistInfo: (id, info) =>
    query("updatePlaylistInfo", () =>
      db
        .update(playlists)
        .set({ name: info.title, description: info.description })
        .where(sql`${playlists.id} = ${id}`),
    ).map(() => undefined),

  listVideoIds: () =>
    query("listVideoIds", () =>
      db.select({ id: videos.id, youtubeId: videos.youtubeId }).from(videos),
    ),

  upsertVideos: (fetched) =>
    query("upsertVideos", async () => {
      for (const rows of chunk(fetched, 10))
        await db
          .insert(videos)
          .values(rows.map(toVideoRow))
          .onConflictDoUpdate({
            target: videos.youtubeId,
            set: {
              title: sql`excluded.title`,
              description: sql`excluded.description`,
              durationSeconds: sql`excluded.duration_seconds`,
              aspectRatio: sql`excluded.aspect_ratio`,
              publishedAt: sql`excluded.published_at`,
              tags: sql`excluded.tags`,
            },
          });
    }),

  insertNewVideos: (fetched) =>
    query("insertNewVideos", async () => {
      const inserted: { id: number; youtubeId: string }[] = [];
      for (const rows of chunk(fetched, 10))
        inserted.push(
          ...(await db
            .insert(videos)
            .values(rows.map(toVideoRow))
            .onConflictDoNothing()
            .returning({ id: videos.id, youtubeId: videos.youtubeId })),
        );
      return inserted;
    }),

  listLinks: () => query("listLinks", () => db.select().from(playlistVideos)),

  deleteLinks: ({ playlistId, videoIds }) =>
    query("deleteLinks", async () => {
      for (const part of chunk(videoIds, 50))
        await db
          .delete(playlistVideos)
          .where(
            sql`${playlistVideos.playlistId} = ${playlistId} AND ${inArray(playlistVideos.videoId, part)}`,
          );
    }),

  upsertLinks: (links) =>
    query("upsertLinks", async () => {
      for (const rows of chunk(links, 20))
        await db
          .insert(playlistVideos)
          .values(rows)
          .onConflictDoUpdate({
            target: [playlistVideos.playlistId, playlistVideos.videoId],
            set: { position: sql`excluded.position` },
          });
    }),

  insertLinks: (links) =>
    query("insertLinks", async () => {
      for (const rows of chunk(links, 20))
        await db.insert(playlistVideos).values(rows).onConflictDoNothing();
    }),

  deleteOrphanVideos: () =>
    query("deleteOrphanVideos", async () => {
      const orphans = await db
        .select({ id: videos.id })
        .from(videos)
        .where(sql`${videos.id} NOT IN (SELECT video_id FROM playlist_videos)`);
      for (const part of chunk(
        orphans.map((row) => row.id),
        50,
      ))
        await db.delete(videos).where(inArray(videos.id, part));
      return orphans.length;
    }),
});
