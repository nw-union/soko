// 動画の同期の実行. cron (crons/sync-videos.ts・crons/sync-new-videos.ts) と, デバッグ画面 (routes/api/debug/) から呼ぶ.
// 同期の結果をログに残し, 通知まで行う. 結果のイベントは呼び出し元に返す
import { match } from "ts-pattern";
import type { AllSyncedEvt, NewSyncedEvt } from "../../domain/Content/api.ts";
import { container } from "../container.ts";
import { throwError } from "../http/error.ts";
import { log } from "../log/log.ts";
import { notifyNew } from "./notify.ts";
import { onNewSynced } from "./policy.ts";

/** 全件の同期. 同期できたら新着を通知する */
export const runSyncAll = async (): Promise<AllSyncedEvt> => {
  const evt = await container()
    .contentWorkFlows.syncAll()
    .match((e) => e, throwError);
  const done = match(evt)
    .with({ type: "NoApiKey" }, () => {
      log().warn(
        "sync-videos: YOUTUBE_API_KEY が未設定のため、取得をスキップします",
      );
      return false;
    })
    .with({ type: "NoPlaylists" }, () => {
      log().warn(
        "sync-videos: playlists にプレイリストが登録されていないため、取得をスキップします",
      );
      return false;
    })
    .with({ type: "Synced" }, (e) => {
      if (e.removalSkipped)
        log().warn(
          "sync-videos: 取得できた動画が 0 件のため、動画の削除はスキップします",
        );
      log().info(
        `sync-videos: 動画 ${e.videos} 件、プレイリスト ${e.playlists} 件、紐付け ${e.links} 件を反映し、動画 ${e.removed} 件を削除、プレイリストの名前・説明 ${e.renamed} 件を更新しました`,
      );
      return true;
    })
    .exhaustive();
  if (done) await notifyNew();
  return evt;
};

/** 差分の同期. 動画が増えたら, ポリシーが新着を通知する */
export const runSyncNew = async (): Promise<NewSyncedEvt> => {
  const evt = await container()
    .contentWorkFlows.syncNew()
    .match((e) => e, throwError);
  // 未設定・未登録の警告は、全件の同期が出す
  if (evt.type !== "Synced") return evt;
  if (evt.added > 0 || evt.links > 0)
    log().info(
      `sync-new-videos: 動画 ${evt.added} 件、紐付け ${evt.links} 件を追加しました`,
    );
  await onNewSynced(evt, notifyNew);
  return evt;
};
