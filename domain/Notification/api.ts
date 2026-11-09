// 通知集約の入口の I/F（アプリケーションサービス）: WorkFlows（コマンド）と Queries（Read Model）、Cmd / Evt / Query / View / DTO。
// Web 層（pages/ routes/ crons/ auth.ts）は、ここに定義した型と server/container.ts の WorkFlows・Queries だけを使う。
// 入力（Cmd / Query）は画面や API から来た値のまま受け取り、検証はドメインで行う。
// 出口の I/F（副作用）は port.ts に置く
import type { ResultAsync } from "neverthrow";
import type { AppError } from "../shared/error.ts";

/**
 * 通知集約のコマンド: Web Push の購読と、新着動画の通知
 */
export interface NotificationWorkFlows {
  /**
   * 購読を保存する. 同じ端末なら, ログインしているユーザーと鍵を上書きする.
   * 1 人が持てる購読は 10 件まで (超えたら古いものから消す)
   */
  subscribe(cmd: SubscribeCmd): ResultAsync<void, AppError>;

  /**
   * 購読を消す (通知をオフにしたとき・ログアウトするとき)
   */
  unsubscribe(cmd: UnsubscribeCmd): ResultAsync<void, AppError>;

  /**
   * まだ通知していない動画を通知済みにして, そのうち最近のものを全購読者に 1 通で知らせる.
   * 新規追加動画があった場合に, ポリシー (server/process/policy.ts) が呼ぶ. 全件の同期の cron も, 取りこぼしを拾うために呼ぶ
   */
  notifyNew(): ResultAsync<NewNotifiedEvt, AppError>;
}

/**
 * 通知集約の Read Model
 */
export interface NotificationQueries {
  /**
   * 購読に使う VAPID の公開鍵. サーバーに鍵がなければ null (通知の設定を出さない)
   */
  getPublicKey(): ResultAsync<PublicKeyView, AppError>;
}

export type PublicKeyView = { publicKey: string | null };

export type SubscribeCmd = {
  userId: string;
  // ブラウザの PushSubscription.toJSON() のまま
  body: unknown;
};

export type UnsubscribeCmd = { userId: string; endpoint: unknown };

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
