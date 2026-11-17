// 通知集約の入口の I/F（ユースケース）: NotificationUsecase と、Cmd / Evt / Query / View / DTO。
// Web 層（pages/ routes/ crons/ auth.ts）は、ここに定義した型と server/container.ts の notificationUsecase だけを使う。
// 入力（Cmd / Query）は画面や API から来た値のまま受け取り、検証はドメインで行う。
// 出口の I/F（副作用）は port.ts に置く
import type { ResultAsync } from "@nw-union/nw-utils/lib/rslt";
import type { AppError } from "../shared/error.ts";

// ----------------------------------------------------------------------------
// Commands
// ----------------------------------------------------------------------------
/**
 * Subscribe 購読する
 *
 * 購読を保存する. 同じ端末なら, ログインしているユーザーと鍵を上書きする.
 * 1 人が持てる購読は 10 件まで (超えたら古いものから消す)
 */
type Subscribe = (cmd: SubscribeCmd) => ResultAsync<void, AppError>;

export type SubscribeCmd = {
  userId: string;
  // ブラウザの PushSubscription.toJSON() のまま
  body: unknown;
};

/**
 * Unsubscribe 購読をやめる
 *
 * 購読を消す (通知をオフにしたとき・ログアウトするとき)
 */
type Unsubscribe = (cmd: UnsubscribeCmd) => ResultAsync<void, AppError>;

export type UnsubscribeCmd = { userId: string; endpoint: unknown };

/**
 * NotifyNew 新着を通知する
 *
 * まだ通知していない動画を通知済みにして, そのうち最近のものを全購読者に 1 通で知らせる.
 * 新規追加動画があった場合に, ポリシー (server/process/policy.ts) が呼ぶ. 全件の同期の cron も, 取りこぼしを拾うために呼ぶ
 */
type NotifyNew = () => ResultAsync<NewNotifiedEvt, AppError>;

export type NewNotifiedEvt =
  // 通知する (最近の) 新着がなかった
  | { type: "NoRecentVideos" }
  // VAPID の鍵がないので送らなかった (動画は通知済みにした)
  | { type: "NoVapidKeys"; videos: number }
  | {
      type: "Notified";
      // 通知した動画の本数
      videos: number;
      // 届いた数 / 送った数
      sent: number;
      total: number;
      // 端末が購読をやめていたので消した数
      removed: number;
      // 届かなかった理由 (プッシュサービスの応答のステータスなど)
      failures: string[];
      // バッジの本数を数えられなかった理由 (それでも通知は送る)
      badgeError: string | null;
    };

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------
/**
 * 購読に使う VAPID の公開鍵. サーバーに鍵がなければ null (通知の設定を出さない)
 */
type GetPublicKey = () => ResultAsync<PublicKeyView, AppError>;

export type PublicKeyView = { publicKey: string | null };

// ----------------------------------------------------------------------------
// 通知集約 ユースケース
// ----------------------------------------------------------------------------
export interface NotificationUsecase {
  // Commands
  subscribe: Subscribe;
  unsubscribe: Unsubscribe;
  notifyNew: NotifyNew;

  // Queries
  getPublicKey: GetPublicKey;
}
