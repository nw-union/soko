import { err, ok, Result, ResultAsync } from "neverthrow";
import {
  newValidationErrorWithMessage,
  type ValidationError,
} from "../../error.ts";
import { base64urlToBytes } from "../base64url.ts";
import type { UserId } from "../vo.ts";
import type {
  ClaimedVideo,
  NewSubscription,
  PushPayload,
  SendResult,
  StoredSubscription,
} from "./type.ts";
import { newPushAuth, newPushEndpoint, newPushP256dh } from "./vo.ts";

/**
 * 1 人が持てる購読 (端末) の数. 超えたら古いものから消す.
 * 購読が増えすぎると, cron 1 回の送信数が Workers のサブリクエストの
 * 上限に届いて,  全員に届かなくなる
 */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * 投稿からこれより古い動画は, 新しく取り込んでも通知しない.
 * プレイリストを追加したときなどに, 昔の動画の通知がまとめて届かないように
 */
export const RECENT_DAYS = 3;

// プッシュの本文は 4KB まで. 暗号化の分を見込んで, 本文は短く切る
const BODY_MAX = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------
// Domain Logic (Domain Type -> Domain Type)
// ----------------------------------------------------------------------------
/**
 * 通知する動画を選ぶ. 投稿から RECENT_DAYS 日以内のものだけを, 新しい順に
 */
export const selectRecent = (
  claimed: readonly ClaimedVideo[],
  now: Date,
): ClaimedVideo[] => {
  const since = now.getTime() - RECENT_DAYS * DAY_MS;
  return claimed
    .filter((v) => v.publishedAt && Date.parse(v.publishedAt) >= since)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
};

/**
 * 通知の中身を作る (全購読者に 1 通). 押すと, いちばん新しい動画を再生する
 *
 * @param recent - 通知する動画 (新しい順. 1 本以上)
 */
export const buildPayload = (recent: readonly ClaimedVideo[]): PushPayload => {
  const body = recent.map((v) => v.title).join(" / ");
  return {
    title: recent.length === 1 ? "新着動画" : `新着動画が ${recent.length} 本`,
    body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX - 1)}…` : body,
    url: `/?v=${recent[0].youtubeId}`,
  };
};

/**
 * プッシュサービスの応答を, 送信の結果にする. 404 / 410 は端末が購読をやめた (アプリを消したなど)
 */
export const classifySendResult = (
  sub: StoredSubscription,
  status: number,
): SendResult =>
  status >= 200 && status < 300
    ? { type: "Sent" }
    : status === 404 || status === 410
      ? { type: "Gone", subscriptionId: sub.id }
      : { type: "Failed", reason: String(status) };

// ----------------------------------------------------------------------------
// Validater (DTO -> Domain Type)
// ----------------------------------------------------------------------------
const invalidSubscription = (): ValidationError =>
  newValidationErrorWithMessage("subscription", "購読の内容が正しくありません");

/**
 * 購読の鍵が, 送るときに暗号化できる形か (p256dh は P-256 の非圧縮の公開鍵 65 バイト, auth は 16 バイト).
 * 壊れた鍵の購読は, 送るたびに暗号化で失敗し続けるので, 保存する前に弾く
 */
export const isValidSubscriptionKeys = async (
  p256dh: string,
  auth: string,
): Promise<boolean> => {
  try {
    const publicKey = base64urlToBytes(p256dh);
    if (publicKey.length !== 65 || publicKey[0] !== 4) return false;
    if (base64urlToBytes(auth).length !== 16) return false;
    // 曲線上の点でなければ, ここで例外になる
    await crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * ブラウザが送ってくる購読 (PushSubscription.toJSON()) を検証する. どこが違っても同じエラーにする
 */
export const validateSubscription = (
  userId: UserId,
  body: unknown,
): ResultAsync<NewSubscription, ValidationError> => {
  const b = body as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  } | null;
  return Result.combine([
    newPushEndpoint(b?.endpoint),
    newPushP256dh(b?.keys?.p256dh),
    newPushAuth(b?.keys?.auth),
  ])
    .mapErr(invalidSubscription)
    .asyncAndThen(([endpoint, p256dh, auth]) =>
      ResultAsync.fromSafePromise(
        isValidSubscriptionKeys(p256dh, auth),
      ).andThen((valid) =>
        valid
          ? ok<NewSubscription, ValidationError>({
              type: "NewSubscription",
              userId,
              endpoint,
              p256dh,
              auth,
            })
          : err(invalidSubscription()),
      ),
    );
};

/**
 * 購読を消すときの endpoint を検証する (自分の購読しか消さないので, 形は問わない)
 */
export const validateEndpointToDelete = (
  endpoint: unknown,
): Result<string, ValidationError> =>
  typeof endpoint === "string" && endpoint !== ""
    ? ok(endpoint)
    : err(newValidationErrorWithMessage("endpoint", "endpoint がありません"));
