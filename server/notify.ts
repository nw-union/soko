// 新着動画のプッシュ通知を送り、結果をログに残す。動画を同期する cron（crons/sync-*.ts）の最後に呼ぶ
import { match } from "ts-pattern";
import { container } from "./container.ts";
import { throwError } from "./http.ts";

export const notifyNewVideos = async () => {
  const evt = await container()
    .pushWorkFlows.notifyNewVideos()
    .match((e) => e, throwError);
  match(evt)
    .with({ type: "NoRecentVideos" }, () => {})
    .with({ type: "NoVapidKeys" }, ({ videos }) =>
      console.warn(
        `push: VAPID の鍵が未設定のため、新着動画 ${videos} 本の通知をスキップします`,
      ),
    )
    .with({ type: "Notified" }, (e) => {
      if (e.badgeError)
        console.warn(
          `push: バッジの件数を数えられませんでした: ${e.badgeError}`,
        );
      for (const reason of e.failures)
        console.warn(`push: 送信に失敗しました: ${reason}`);
      console.log(
        `push: 新着動画 ${e.videos} 本を ${e.sent} / ${e.total} 件に通知しました（無効な購読 ${e.removed} 件を削除）`,
      );
    })
    .exhaustive();
};
