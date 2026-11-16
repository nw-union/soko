import { defineScheduled } from "void";
import { runSyncNew } from "../server/process/sync.ts";

// 差分の同期。30 分ごとに、プレイリストに増えた動画だけを videos に足して紐付ける。動画が増えたら、ポリシー（server/process/policy.ts）が新着を通知する。
// 既にある動画の更新・並び替え・削除はしない（crons/sync-videos.ts が 8 時間ごとに直す）。
// プレイリストの並びは新しい順とは限らないので、動画 ID の一覧は全ページ取る（50 本で 1 クォータと安い）。
// 詳細（videos.list）を引くのは DB にない動画だけ。埋め込み不可など表示しない動画も DB にないので毎回引き直すが、
// 50 本で 1 クォータなので気にしない。全件の同期と時刻をずらす（:00 を避ける）
export const cron = "15,45 * * * *";

export default defineScheduled(async () => {
  await runSyncNew();
});
