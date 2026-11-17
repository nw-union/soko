// ワークフロー: 購読 (Subscribe 購読する・Unsubscribe 購読をやめる・購読に使う公開鍵)
import {
  err,
  ok,
  type Result,
  type ResultAsync,
  rslt,
  sequence,
  stepAsync,
  throughAsync,
} from "@nw-union/nw-utils/lib/rslt";
import { base64urlToBytes } from "../../../lib/base64url.ts";
import {
  newValidationErrorWithMessage,
  type ValidationError,
} from "../../shared/error.ts";
import { newUserId, type UserId } from "../../shared/vo.ts";
import type { NotificationUsecase } from "../api.ts";
import type { PushRepositoryPort } from "../port.ts";
import type { NewSubscription, VapidKeys } from "../type.ts";
import { newPushAuth, newPushEndpoint, newPushP256dh } from "../vo.ts";

// ----------------------------------------------------------------------------
// 依存
// ----------------------------------------------------------------------------
type SubscriptionRepository = Pick<
  PushRepositoryPort,
  "upsertSubscription" | "trimSubscriptions" | "deleteSubscription"
>;

/**
 * 1 人が持てる購読 (端末) の数. 超えたら古いものから消す.
 * 購読が増えすぎると, cron 1 回の送信数が Workers のサブリクエストの
 * 上限に届いて,  全員に届かなくなる
 */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

// ----------------------------------------------------------------------------
// Step: バリデーション (Cmd → ドメインの型)
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
  return stepAsync(
    rslt.pipe(
      sequence([
        newPushEndpoint(b?.endpoint),
        newPushP256dh(b?.keys?.p256dh),
        newPushAuth(b?.keys?.auth),
      ]),
      rslt.mapErr(invalidSubscription),
    ),
    async ([endpoint, p256dh, auth]) =>
      (await isValidSubscriptionKeys(p256dh, auth))
        ? ok<NewSubscription>({
            type: "NewSubscription",
            userId,
            endpoint,
            p256dh,
            auth,
          })
        : err(invalidSubscription()),
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

// ----------------------------------------------------------------------------
// 実装
// ----------------------------------------------------------------------------
/**
 * Web Push の購読
 *
 * @param vapid - VAPID の鍵. どれかが未設定なら null (通知の機能を使わない)
 */
export const newSubscriptionWorkflow = (
  r: SubscriptionRepository,
  vapid: VapidKeys | null,
): Pick<NotificationUsecase, "subscribe" | "unsubscribe" | "getPublicKey"> => ({
  /**
   * 購読を保存する
   */
  subscribe: ({ userId, body }) =>
    stepAsync(
      // Step 1. バリデーション: [string, unknown] -> NewSubscription
      newUserId(userId),
      (user) => validateSubscription(user, body),
      // Step 2. DB 保存
      throughAsync(r.upsertSubscription),
      // Step 3. 古い購読を消す (1 人 MAX_SUBSCRIPTIONS_PER_USER 件まで)
      (sub) => r.trimSubscriptions(sub.userId, MAX_SUBSCRIPTIONS_PER_USER),
    ),

  /**
   * 購読を消す
   */
  unsubscribe: ({ userId, endpoint }) =>
    stepAsync(
      // Step 1. バリデーション: [string, unknown] -> [UserId, string]
      sequence([newUserId(userId), validateEndpointToDelete(endpoint)]),
      // Step 2. DB 削除
      ([user, e]) => r.deleteSubscription(user, e),
    ),

  /**
   * 購読に使う VAPID の公開鍵
   */
  getPublicKey: async () => ok({ publicKey: vapid?.publicKey ?? null }),
});
