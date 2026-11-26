// 動画の同期の実行. cron (crons/sync-videos.ts・crons/sync-new-videos.ts) と, デバッグ画面 (routes/api/debug/) から呼ぶ.
// 同期の結果をログに残し, 通知まで行う. 結果のイベントは呼び出し元に返す
import { match } from "@nw-union/nw-utils/lib/match";
import type { AllSyncedEvt, NewSyncedEvt } from "../../domain/Content/api.ts";
import { container } from "../container.ts";
import { valueOrThrow } from "../http/error.ts";
import { log } from "../log/log.ts";
import { notify } from "./notify.ts";
import { onVideosSynced } from "./policy.ts";

/** 全件の同期. 動画が増えたら, ポリシーが新着を通知する */
export const runSyncAll = async (): Promise<AllSyncedEvt> => {
  const evt = await valueOrThrow(container().contentUsecase.syncAll());
  match(evt)
    .with({ type: "NoApiKey" }, () =>
      log().warn(
        "sync-videos: YOUTUBE_API_KEY が未設定のため、取得をスキップします",
      ),
    )
    .with({ type: "NoPlaylists" }, () =>
      log().warn(
        "sync-videos: playlists にプレイリストが登録されていないため、取得をスキップします",
      ),
    )
    .with({ type: "Synced" }, (e) => {
      if (e.removalSkipped)
        log().warn(
          "sync-videos: 取得できた動画が 0 件のため、動画の削除はスキップします",
        );
      log().info(
        `sync-videos: 動画 ${e.videos} 件（うち新規 ${e.addedVideoIds.length} 件）、プレイリスト ${e.playlists} 件、紐付け ${e.links} 件を反映し、動画 ${e.removed} 件を削除、プレイリストの名前・説明 ${e.renamed} 件を更新しました`,
      );
    })
    .exhaustive();
  await onVideosSynced(evt, notify);
  return evt;
};

/** 差分の同期. 動画が増えたら, ポリシーが新着を通知する */
export const runSyncNew = async (): Promise<NewSyncedEvt> => {
  const evt = await valueOrThrow(container().contentUsecase.syncNew());
  // 未設定・未登録の警告は、全件の同期が出す
  if (evt.type !== "Synced") return evt;
  if (evt.addedVideoIds.length > 0 || evt.links > 0)
    log().info(
      `sync-new-videos: 動画 ${evt.addedVideoIds.length} 件、紐付け ${evt.links} 件を追加しました`,
    );
  await onVideosSynced(evt, notify);
  return evt;
};
