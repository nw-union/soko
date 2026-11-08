import type { UserId } from "../vo.ts";
import type { PushAuth, PushEndpoint, PushP256dh } from "./vo.ts";

/**
 * VAPID の鍵 (送信者の認証. RFC 8292)
 */
export interface VapidKeys {
  // 非圧縮の公開鍵 (65 バイト) の base64url
  readonly publicKey: string;
  // 秘密鍵 d (32 バイト) の base64url
  readonly privateKey: string;
  // 連絡先 (mailto:… か https://…)
  readonly subject: string;
}

/**
 * 検証済みの購読 (まだ保存していない)
 */
export interface NewSubscription {
  readonly type: "NewSubscription";

  readonly userId: UserId;
  readonly endpoint: PushEndpoint;
  readonly p256dh: PushP256dh;
  readonly auth: PushAuth;
}

/**
 * 保存されている購読 (送り先)
 */
export interface StoredSubscription {
  readonly id: number;
  readonly userId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * 通知済みにした動画
 */
export interface ClaimedVideo {
  readonly youtubeId: string;
  readonly title: string;
  // ISO 8601. わからなければ null
  readonly publishedAt: string | null;
}

/**
 * sw.js の push イベントが受け取る中身
 */
export interface PushPayload {
  readonly title: string;
  readonly body: string;
  // 通知を押したときに開く URL (/?v=<YouTube の動画 ID> でその動画を再生する)
  readonly url: string;
  // アプリのアイコンのバッジに出す, 未視聴の New の本数. わからなければ空 (バッジを変えない)
  readonly badge?: number;
}

/**
 * 1 件の送信の結果
 *
 * - Sent: 届いた
 * - Gone: 端末が購読をやめた (404 / 410). もう送れないので消す
 * - Failed: それ以外の失敗 (プッシュサービスの応答のステータスか, 送れなかった理由)
 */
export type SendResult =
  | { readonly type: "Sent" }
  | { readonly type: "Gone"; readonly subscriptionId: number }
  | { readonly type: "Failed"; readonly reason: string };
