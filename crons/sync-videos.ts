import { defineScheduled } from "void";
import { runSyncAll } from "../server/process/sync.ts";

// 全件の同期。8 時間ごとに、playlists に登録されたプレイリストの全動画を取り直して videos に反映し
// （タイトル・概要欄などの変更も直す）、playlist_videos の紐付けを作り直す。
// プレイリストの名前（YouTube のタイトル）と説明も YouTube から取り直し、playlists を上書きする。
// どのプレイリストにも入っていない動画は、videos から削除する。
// 新着だけをこまめに拾うのは crons/sync-new-videos.ts
export const cron = "0 */8 * * *";

export default defineScheduled(async () => {
  await runSyncAll();
});
