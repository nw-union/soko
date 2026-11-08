import { defineScheduled } from "void";
import { container } from "../server/container.ts";
import { throwError } from "../server/http.ts";
import { log } from "../server/log.ts";
import { notifyNewVideos } from "../server/notify.ts";
import { onNewSynced } from "../server/policy.ts";

// 差分の同期。30 分ごとに、プレイリストに増えた動画だけを videos に足して紐付ける。動画が増えたら、ポリシー（server/policy.ts）が新着を通知する。
// 既にある動画の更新・並び替え・削除はしない（crons/sync-videos.ts が 8 時間ごとに直す）。
// プレイリストの並びは新しい順とは限らないので、動画 ID の一覧は全ページ取る（50 本で 1 クォータと安い）。
// 詳細（videos.list）を引くのは DB にない動画だけ。埋め込み不可など表示しない動画も DB にないので毎回引き直すが、
// 50 本で 1 クォータなので気にしない。全件の同期と時刻をずらす（:00 を避ける）
export const cron = "15,45 * * * *";

export default defineScheduled(async () => {
  const evt = await container()
    .contentWorkFlows.syncNew()
    .match((e) => e, throwError);
  // 未設定・未登録の警告は、全件の同期が出す
  if (evt.type !== "Synced") return;
  if (evt.added > 0 || evt.links > 0)
    log().info(
      `sync-new-videos: 動画 ${evt.added} 件、紐付け ${evt.links} 件を追加しました`,
    );
  await onNewSynced(evt, notifyNewVideos);
});
