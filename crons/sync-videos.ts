import { defineScheduled } from "void";
import { db, inArray, sql } from "void/db";
import { env } from "void/env";
import { playlists, playlistVideos, videos } from "@schema";
import { fetchPlaylistVideoIds, fetchVideos } from "../src/lib/youtube-api";

// 6 時間ごとに、playlists に登録されたプレイリストの動画を videos に反映し、playlist_videos の紐付けを作り直す。
// どのプレイリストにも入っていない動画は、videos から削除する
export const cron = "0 */6 * * *";

// D1 は 1 文のバインド変数が 100 個までなので、まとめて渡すときは分ける
const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
};

export default defineScheduled(async () => {
  const key = env.YOUTUBE_API_KEY;
  if (!key) {
    console.warn(
      "sync-videos: YOUTUBE_API_KEY が未設定のため、取得をスキップします",
    );
    return;
  }
  const lists = await db.select().from(playlists);
  if (lists.length === 0) {
    console.warn(
      "sync-videos: playlists にプレイリストが登録されていないため、取得をスキップします",
    );
    return;
  }

  // 先に全プレイリストの動画 ID を取る。1 つでも失敗したら例外で止まり、DB は何も変わらない
  const idsByList = new Map<number, string[]>();
  for (const list of lists)
    idsByList.set(list.id, await fetchPlaylistVideoIds(list.playlistId, key));

  const ids = [...new Set([...idsByList.values()].flat())];
  const fetched = await fetchVideos(ids, key);

  for (const rows of chunk(fetched, 10)) {
    await db
      .insert(videos)
      .values(
        rows.map(({ tags, ...video }) => ({
          ...video,
          tags: JSON.stringify(tags),
        })),
      )
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

  // 紐付け。表示対象として取得できた動画だけを、プレイリストの順に結ぶ
  const stored = await db
    .select({ id: videos.id, youtubeId: videos.youtubeId })
    .from(videos);
  const rowId = new Map(stored.map((row) => [row.youtubeId, row.id]));
  const fetchedIds = new Set(fetched.map((video) => video.youtubeId));
  const currentLinks = await db.select().from(playlistVideos);

  let linked = 0;
  for (const list of lists) {
    const wanted = new Map<number, number>(); // videoId → position
    for (const youtubeId of idsByList.get(list.id) ?? []) {
      const videoId = rowId.get(youtubeId);
      if (
        videoId !== undefined &&
        fetchedIds.has(youtubeId) &&
        !wanted.has(videoId)
      )
        wanted.set(videoId, wanted.size);
    }

    // プレイリストから外れた（または表示対象でなくなった）動画の紐付けを消す
    const stale = currentLinks
      .filter(
        (link) => link.playlistId === list.id && !wanted.has(link.videoId),
      )
      .map((link) => link.videoId);
    for (const part of chunk(stale, 50)) {
      await db
        .delete(playlistVideos)
        .where(
          sql`${playlistVideos.playlistId} = ${list.id} AND ${inArray(playlistVideos.videoId, part)}`,
        );
    }

    const values = [...wanted].map(([videoId, position]) => ({
      playlistId: list.id,
      videoId,
      position,
    }));
    for (const rows of chunk(values, 20)) {
      await db
        .insert(playlistVideos)
        .values(rows)
        .onConflictDoUpdate({
          target: [playlistVideos.playlistId, playlistVideos.videoId],
          set: { position: sql`excluded.position` },
        });
    }
    linked += values.length;
  }

  // どのプレイリストにも入っていない動画を消す。取得結果が空のときは、API の異常で全部消すことのないよう何もしない
  let removed = 0;
  if (fetched.length > 0) {
    const orphans = await db
      .select({ id: videos.id })
      .from(videos)
      .where(sql`${videos.id} NOT IN (SELECT video_id FROM playlist_videos)`);
    for (const part of chunk(
      orphans.map((row) => row.id),
      50,
    ))
      await db.delete(videos).where(inArray(videos.id, part));
    removed = orphans.length;
  } else {
    console.warn(
      "sync-videos: 取得できた動画が 0 件のため、動画の削除はスキップします",
    );
  }
  console.log(
    `sync-videos: 動画 ${fetched.length} 件、プレイリスト ${lists.length} 件、紐付け ${linked} 件を反映し、動画 ${removed} 件を削除しました`,
  );
});
