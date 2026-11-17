import { stepAsync } from "@nw-union/nw-utils/lib/rslt";
import { asc, desc, eq, inArray, sql } from "void/db";
// auth.ts から読み込まれるので、Vite のエイリアス（@schema）ではなく相対パスで読む（Void の CLI はエイリアスを解決できない）
import {
  playlists,
  playlistVideos,
  videos,
  videoWatches,
} from "../../db/schema.ts";
import type { ContentRepositoryPort } from "../../domain/Content/port.ts";
import type {
  FetchedVideo,
  Playlist,
  StoredVideo,
} from "../../domain/Content/type.ts";
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

// ホームで使う列. 概要欄 (description) は大きいので読まない
const storedVideoColumns = {
  id: videos.id,
  youtubeId: videos.youtubeId,
  title: videos.title,
  durationSeconds: videos.durationSeconds,
  aspectRatio: videos.aspectRatio,
  publishedAt: videos.publishedAt,
  tags: videos.tags,
};

type StoredVideoRow = {
  [K in keyof typeof storedVideoColumns]: (typeof videos.$inferSelect)[K];
};

const toStoredVideo = (row: StoredVideoRow): StoredVideo => ({
  type: "StoredVideo",
  id: row.id,
  youtubeId: row.youtubeId,
  title: row.title,
  durationSeconds: row.durationSeconds,
  aspectRatio: row.aspectRatio,
  publishedAt: row.publishedAt,
  tags: parseTags(row.tags),
});

const toPlaylist = (list: typeof playlists.$inferSelect): Playlist => ({
  type: "Playlist",
  id: list.id,
  playlistId: list.playlistId,
  name: list.name,
  description: list.description,
});

const selectPlaylists = (db: Database) =>
  db
    .select()
    .from(playlists)
    .orderBy(asc(playlists.position), asc(playlists.id));

// ----------------------------------------------------------------------------
// Repository
// ----------------------------------------------------------------------------
export const newContentRepository = (db: Database): ContentRepositoryPort => ({
  listPlaylists: () =>
    stepAsync(
      query("listPlaylists", () => selectPlaylists(db)),
      (rows) => rows.map(toPlaylist),
    ),

  // ページを開くたびに呼ぶので, 3 つの SELECT を db.batch で 1 往復にまとめる
  loadHomeFeed: (user) =>
    stepAsync(
      query("loadHomeFeed", () =>
        db.batch([
          selectPlaylists(db),
          db
            .select({
              playlistId: playlistVideos.playlistId,
              video: storedVideoColumns,
            })
            .from(playlistVideos)
            .innerJoin(videos, eq(videos.id, playlistVideos.videoId))
            .orderBy(desc(videos.publishedAt), asc(videos.id)),
          db
            .select({ youtubeId: videoWatches.youtubeId })
            .from(videoWatches)
            .where(eq(videoWatches.userId, user)),
        ]),
      ),
      ([lists, rows, watched]) => ({
        lists: lists.map(toPlaylist),
        rows: rows.map((row) => ({
          playlistId: row.playlistId,
          video: toStoredVideo(row.video),
        })),
        watchedIds: watched.map((row) => row.youtubeId),
      }),
    ),

  findVideoDescription: (youtubeId) =>
    stepAsync(
      query("findVideoDescription", () =>
        db
          .select({ description: videos.description })
          .from(videos)
          .where(eq(videos.youtubeId, youtubeId))
          .limit(1),
      ),
      (rows) => (rows[0] ? (rows[0].description ?? "") : null),
    ),

  listPlaylistVideoDates: () =>
    stepAsync(
      query("listPlaylistVideoDates", () =>
        db.all<{ youtube_id: string; published_at: string | null }>(sql`
        SELECT youtube_id, published_at FROM videos
        WHERE id IN (SELECT video_id FROM playlist_videos)`),
      ),
      (rows) =>
        rows.map((row) => ({
          youtubeId: row.youtube_id,
          publishedAt: row.published_at,
        })),
    ),

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
    stepAsync(
      query("listMembers", () =>
        db.all<{ id: string; createdAt: number }>(
          sql`SELECT id, createdAt FROM user WHERE id IN (${sql.join(
            users.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      ),
      (rows) =>
        rows.map((row) => ({
          id: row.id as (typeof users)[number],
          joinedAt: new Date(row.createdAt),
        })),
    ),

  insertWatch: (user, youtubeId) =>
    stepAsync(
      query("insertWatch", () =>
        db.run(sql`
        INSERT INTO video_watches (user_id, youtube_id)
        SELECT ${user}, youtube_id FROM videos WHERE youtube_id = ${youtubeId}
        ON CONFLICT DO NOTHING`),
      ),
      () => undefined,
    ),

  deleteWatch: (user, youtubeId) =>
    stepAsync(
      query("deleteWatch", () =>
        db.run(
          sql`DELETE FROM video_watches WHERE user_id = ${user} AND youtube_id = ${youtubeId}`,
        ),
      ),
      () => undefined,
    ),

  deleteWatches: (user) =>
    stepAsync(
      query("deleteWatches", () =>
        db.run(sql`DELETE FROM video_watches WHERE user_id = ${user}`),
      ),
      () => undefined,
    ),

  // ---- プレイリストの管理 ----

  insertPlaylist: (id) =>
    stepAsync(
      query("insertPlaylist", () =>
        db
          .insert(playlists)
          .values({ playlistId: id })
          .onConflictDoNothing()
          .returning(),
      ),
      (rows) => (rows[0] ? toPlaylist(rows[0]) : null),
    ),

  deletePlaylist: (id) =>
    stepAsync(
      query("deletePlaylist", () =>
        db.delete(playlists).where(eq(playlists.id, id)),
      ),
      () => undefined,
    ),

  // ---- YouTube からの取り込み ----

  updatePlaylistInfo: (id, info) =>
    stepAsync(
      query("updatePlaylistInfo", () =>
        db
          .update(playlists)
          .set({ name: info.title, description: info.description })
          .where(sql`${playlists.id} = ${id}`),
      ),
      () => undefined,
    ),

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
            // 中身が同じ行は書き直さない (D1 は書いた行数を数える). NULL どうしも同じとみなすよう IS NOT で比べる
            setWhere: sql`${videos.title} IS NOT excluded.title
              OR ${videos.description} IS NOT excluded.description
              OR ${videos.durationSeconds} IS NOT excluded.duration_seconds
              OR ${videos.aspectRatio} IS NOT excluded.aspect_ratio
              OR ${videos.publishedAt} IS NOT excluded.published_at
              OR ${videos.tags} IS NOT excluded.tags`,
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
    stepAsync(
      query("deleteOrphanVideos", () =>
        // 1 文で探して消す (playlist_videos_video_idx を使う)
        db
          .delete(videos)
          .where(
            sql`NOT EXISTS (SELECT 1 FROM ${playlistVideos} WHERE ${playlistVideos.videoId} = ${videos.id})`,
          )
          .returning({ id: videos.id }),
      ),
      (removed) => removed.length,
    ),
});
