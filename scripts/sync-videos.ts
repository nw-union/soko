#!/usr/bin/env bun
// YouTube プレイリスト（限定公開でもよい）の動画を取得して、videos テーブルに登録する（管理者用。crons/sync-videos.ts と同じ処理）。
//
//   YOUTUBE_API_KEY=xxx YOUTUBE_PLAYLIST_ID=PLxxx bun scripts/sync-videos.ts [--remote] [--dry-run]
//
// --remote   デプロイ済みの本番 DB に登録する（省略するとローカル DB）
// --dry-run  取得した動画を表示するだけで、DB には書かない
// 登録済みの動画は、タイトル・概要欄・長さ・投稿日時だけ更新する（position は触らない）。
import { spawnSync } from "node:child_process";
import { fetchPlaylistVideoIds, fetchVideos } from "../src/lib/youtube-api";

const key = process.env.YOUTUBE_API_KEY;
const playlistId = process.env.YOUTUBE_PLAYLIST_ID;
if (!key || !playlistId) {
  console.error("エラー: YOUTUBE_API_KEY と YOUTUBE_PLAYLIST_ID を環境変数で指定してください");
  process.exit(1);
}

const remote = process.argv.includes("--remote");
const dryRun = process.argv.includes("--dry-run");

const videos = await fetchVideos(await fetchPlaylistVideoIds(playlistId, key), key);
console.table(videos.map((v) => ({ id: v.youtubeId, title: v.title, sec: v.durationSeconds, published: v.publishedAt, tags: v.tags.join(" ") })));
if (dryRun || videos.length === 0) process.exit(0);

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const sql = videos
  .map(
    (v) =>
      "INSERT INTO videos (youtube_id, title, description, duration_seconds, published_at, tags) VALUES (" +
      [quote(v.youtubeId), quote(v.title), quote(v.description), v.durationSeconds ?? "NULL", quote(v.publishedAt), quote(JSON.stringify(v.tags))].join(", ") +
      ") ON CONFLICT(youtube_id) DO UPDATE SET title = excluded.title, description = excluded.description, " +
      "duration_seconds = excluded.duration_seconds, published_at = excluded.published_at, tags = excluded.tags;",
  )
  .join("\n");

const result = spawnSync("bunx", ["void", "db", "execute", ...(remote ? ["--remote"] : []), sql], {
  stdio: ["ignore", "inherit", "inherit"],
});
if (result.status !== 0) {
  console.error("エラー: DB への登録に失敗しました");
  process.exit(1);
}
console.log(`${videos.length} 件を登録しました（${remote ? "本番 DB" : "ローカル DB"}）`);
