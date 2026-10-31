import { defineScheduled } from "void";
import { db } from "void/db";
import { env } from "void/env";
import { playlists, playlistVideos, videos } from "@schema";
import { notifyNewVideos } from "../src/lib/push-notify";
import { chunk, toVideoRow } from "../src/lib/video-sync";
import { fetchPlaylistVideoIds, fetchVideos } from "../src/lib/youtube-api";

// 差分の同期。30 分ごとに、プレイリストに増えた動画だけを videos に足して紐付け、新着を通知する。
// 既にある動画の更新・並び替え・削除はしない（crons/sync-videos.ts が 8 時間ごとに直す）。
// プレイリストの並びは新しい順とは限らないので、動画 ID の一覧は全ページ取る（50 本で 1 クォータと安い）。
// 詳細（videos.list）を引くのは DB にない動画だけ。ショートなど表示しない動画も DB にないので毎回引き直すが、
// 50 本で 1 クォータなので気にしない。全件の同期と時刻をずらす（:00 を避ける）
export const cron = "15,45 * * * *";

export default defineScheduled(async () => {
  // 未設定・未登録の警告は、全件の同期が出す
  const key = env.YOUTUBE_API_KEY;
  if (!key) return;
  const lists = await db.select().from(playlists);
  if (lists.length === 0) return;

  const idsByList = new Map<number, string[]>();
  for (const list of lists)
    idsByList.set(list.id, await fetchPlaylistVideoIds(list.playlistId, key));

  const stored = await db
    .select({ id: videos.id, youtubeId: videos.youtubeId })
    .from(videos);
  const rowId = new Map(stored.map((row) => [row.youtubeId, row.id]));
  const unknown = [...new Set([...idsByList.values()].flat())].filter(
    (youtubeId) => !rowId.has(youtubeId),
  );

  let added = 0;
  if (unknown.length > 0) {
    const fetched = await fetchVideos(unknown, key);
    for (const rows of chunk(fetched, 10)) {
      // 全件の同期と同時に動いても壊れないよう、既にあれば何もしない
      const inserted = await db
        .insert(videos)
        .values(rows.map(toVideoRow))
        .onConflictDoNothing()
        .returning({ id: videos.id, youtubeId: videos.youtubeId });
      for (const row of inserted) rowId.set(row.youtubeId, row.id);
      added += inserted.length;
    }
  }

  // 足りない紐付けを足す。新しい動画のほか、既にある動画が別のプレイリストに入ったときも
  const links = await db
    .select({
      playlistId: playlistVideos.playlistId,
      videoId: playlistVideos.videoId,
    })
    .from(playlistVideos);
  const linked = new Set(links.map((l) => `${l.playlistId}:${l.videoId}`));
  const values: { playlistId: number; videoId: number; position: number }[] =
    [];
  for (const list of lists) {
    (idsByList.get(list.id) ?? []).forEach((youtubeId, position) => {
      const videoId = rowId.get(youtubeId);
      const link = `${list.id}:${videoId}`;
      if (videoId === undefined || linked.has(link)) return;
      linked.add(link);
      values.push({ playlistId: list.id, videoId, position });
    });
  }
  for (const rows of chunk(values, 20))
    await db.insert(playlistVideos).values(rows).onConflictDoNothing();

  if (added > 0 || values.length > 0)
    console.log(
      `sync-new-videos: 動画 ${added} 件、紐付け ${values.length} 件を追加しました`,
    );

  await notifyNewVideos();
});
