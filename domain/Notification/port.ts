import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../error.ts";
import type { UserId } from "../vo.ts";
import type {
  ClaimedVideo,
  NewSubscription,
  PushPayload,
  StoredSubscription,
  VapidKeys,
} from "./type.ts";

/**
 * 購読と通知済みの記録のリポジトリ
 */
export interface PushRepositoryPort {
  // 購読を保存する. 同じ端末 (endpoint) なら, ユーザーと鍵を上書きする
  upsertSubscription(sub: NewSubscription): ResultAsync<void, AppError>;

  // ユーザーの購読を新しいものから keep 件だけ残し, それより古いものを消す
  trimSubscriptions(user: UserId, keep: number): ResultAsync<void, AppError>;

  // ユーザーの購読を消す (他人の購読は消さない). なくても成功
  deleteSubscription(
    user: UserId,
    endpoint: string,
  ): ResultAsync<void, AppError>;

  // 全員の購読 (送り先)
  listSubscriptions(): ResultAsync<StoredSubscription[], AppError>;

  // 購読を ID で消す
  deleteSubscriptions(ids: number[]): ResultAsync<void, AppError>;

  // まだ通知していない動画を, 通知済み (notified_at = now) にして返す.
  // 確認と更新を 1 つの操作で行うこと (2 つの cron が同時に動いても, 同じ動画を 2 回通知しないように)
  claimUnnotifiedVideos(now: Date): ResultAsync<ClaimedVideo[], AppError>;
}

/**
 * プッシュの送信 (暗号化 RFC 8291 と, 送信者の認証 RFC 8292)
 */
export interface PushSenderPort {
  // 1 件送る. プッシュサービスの応答のステータスを返す. 送れなかったときは理由
  send(
    sub: StoredSubscription,
    payload: PushPayload,
    vapid: VapidKeys,
  ): ResultAsync<number, string>;
}

/**
 * バッジの本数 (コンテンツ集約の, 未視聴の New の本数)
 */
export interface BadgeCounterPort {
  countUnwatchedNew(
    userIds: string[],
  ): ResultAsync<Map<string, number>, AppError>;
}
