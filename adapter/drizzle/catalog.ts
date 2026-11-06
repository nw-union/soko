import { inArray, sql } from "void/db";
import type { CatalogRepositoryPort } from "../../domain/Catalog/port.ts";
import type { FetchedVideo } from "../../domain/Catalog/type.ts";
// auth.ts から読み込まれるので、Vite のエイリアス（@schema）ではなく相対パスで読む
import { playlists, playlistVideos, videos } from "../../db/schema.ts";
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

export const newCatalogRepository = (db: Database): CatalogRepositoryPort => ({
  listPlaylists: () =>
    query("listPlaylists", () => db.select().from(playlists)).map((rows) =>
      rows.map((row) => ({
        id: row.id,
        playlistId: row.playlistId,
        name: row.name,
        description: row.description,
      })),
    ),

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
