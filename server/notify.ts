// 新着動画のプッシュ通知を送り、結果をログに残す。ポリシー（server/policy.ts）と、全件の同期の cron（crons/sync-videos.ts）から呼ぶ
import { match } from "ts-pattern";
import { container } from "./container.ts";
import { throwError } from "./http.ts";
import { log } from "./log.ts";

export const notifyNewVideos = async () => {
  const evt = await container()
    .pushWorkFlows.notifyNewVideos()
    .match((e) => e, throwError);
  match(evt)
    .with({ type: "NoRecentVideos" }, () => {})
    .with({ type: "NoVapidKeys" }, ({ videos }) =>
      log().warn(
        `push: VAPID の鍵が未設定のため、新着動画 ${videos} 本の通知をスキップします`,
      ),
    )
    .with({ type: "Notified" }, (e) => {
      if (e.badgeError)
        log().warn(`push: バッジの件数を数えられませんでした: ${e.badgeError}`);
      for (const reason of e.failures)
        log().warn(`push: 送信に失敗しました: ${reason}`);
      log().info(
        `push: 新着動画 ${e.videos} 本を ${e.sent} / ${e.total} 件に通知しました（無効な購読 ${e.removed} 件を削除）`,
      );
    })
    .exhaustive();
};
