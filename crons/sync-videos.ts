import { match } from "ts-pattern";
import { defineScheduled } from "void";
import { container } from "../server/container.ts";
import { throwError } from "../server/http.ts";
import { log } from "../server/log.ts";
import { notifyNewVideos } from "../server/notify.ts";

// 全件の同期。8 時間ごとに、playlists に登録されたプレイリストの全動画を取り直して videos に反映し
// （タイトル・概要欄などの変更も直す）、playlist_videos の紐付けを作り直す。
// プレイリストの名前（YouTube のタイトル）と説明も YouTube から取り直し、playlists を上書きする。
// どのプレイリストにも入っていない動画は、videos から削除する。
// 新着だけをこまめに拾うのは crons/sync-new-videos.ts
export const cron = "0 */8 * * *";

export default defineScheduled(async () => {
  const evt = await container()
    .catalogWorkFlows.syncAllVideos()
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
  if (done) await notifyNewVideos();
});
