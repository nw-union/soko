import {
  ok,
  type ResultAsync,
  rslt,
  sequence,
  sequenceAsync,
  stepAsync,
  throughAsync,
} from "@nw-union/nw-utils/lib/rslt";
import type { AppError } from "../shared/error.ts";
import type { ClockPort } from "../shared/port.ts";
import { newUserId } from "../shared/vo.ts";
import type { NewNotifiedEvt, NotificationUsecase } from "./api.ts";
import {
  buildPayload,
  classifySendResult,
  MAX_SUBSCRIPTIONS_PER_USER,
  selectRecent,
  validateEndpointToDelete,
  validateSubscription,
} from "./logic.ts";
import type {
  BadgeCounterPort,
  PushRepositoryPort,
  PushSenderPort,
} from "./port.ts";
import type {
  ClaimedVideo,
  PushPayload,
  SendResult,
  StoredSubscription,
  VapidKeys,
} from "./type.ts";

/**
 * 通知集約のユースケースのうち, コマンド (状態を変えるもの). Web Push の購読と, 新着動画の通知
 *
 * @param vapid - VAPID の鍵. どれかが未設定なら null (通知の機能を使わない)
 */
export const newNotificationWorkFlows = (
  r: PushRepositoryPort,
  sender: PushSenderPort,
  badge: BadgeCounterPort,
  clock: ClockPort,
  vapid: VapidKeys | null,
): Pick<NotificationUsecase, "subscribe" | "unsubscribe" | "notifyNew"> => {
  /**
   * 全購読者に送る. 1 件ずつの失敗では止めない
   */
  const sendAll = (
    payload: PushPayload,
    keys: VapidKeys,
    recent: ClaimedVideo[],
  ) =>
    stepAsync(
      // Step 1. 送り先と, バッジの本数の取得 (数えられなくても通知は送る)
      r.listSubscriptions(),
      async (subs) =>
        rslt.pipe(
          await badge.countUnwatchedNew(subs.map((sub) => sub.userId)),
          rslt.map((counts) => ({
            subs,
            counts,
            badgeError: null as string | null,
          })),
          rslt.orElse((e) =>
            ok({
              subs,
              counts: new Map<string, number>(),
              badgeError: `${e.type}: ${e.message}`,
            }),
          ),
        ),
      // Step 2. 送信: 購読ごとに, バッジの本数を入れて送る
      ({ subs, counts, badgeError }) =>
        stepAsync(
          sequenceAsync(
            subs.map((sub) =>
              sendOne(sub, { ...payload, badge: counts.get(sub.userId) }, keys),
            ),
          ),
          (results) => ({ subs, results, badgeError }),
        ),
      // Step 3. 購読をやめた端末の購読を消す
      ({ subs, results, badgeError }) => {
        const gone = results.flatMap((res) =>
          res.type === "Gone" ? [res.subscriptionId] : [],
        );
        return stepAsync(
          gone.length > 0 ? r.deleteSubscriptions(gone) : ok(),
          (): NewNotifiedEvt => ({
            type: "Notified",
            videos: recent.length,
            sent: results.filter((res) => res.type === "Sent").length,
            total: subs.length,
            removed: gone.length,
            failures: results.flatMap((res) =>
              res.type === "Failed" ? [res.reason] : [],
            ),
            badgeError,
          }),
        );
      },
    );

  /**
   * 1 件送り, 結果にする. 送れなかったときも失敗の結果にする (他の購読への送信は続ける)
   */
  const sendOne = async (
    sub: StoredSubscription,
    payload: PushPayload,
    keys: VapidKeys,
  ): ResultAsync<SendResult, never> =>
    rslt.pipe(
      await sender.send(sub, payload, keys),
      rslt.map((status) => classifySendResult(sub, status)),
      rslt.orElse((reason) => ok<SendResult>({ type: "Failed", reason })),
    );

  return {
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
     * 新着動画を通知する
     */
    notifyNew: () => {
      const now = clock.now();
      return stepAsync(
        // Step 1. まだ通知していない動画を, 通知済みにする
        r.claimUnnotifiedVideos(now),
        // Step 2. 通知する動画を選ぶ (最近のものだけ)
        (claimed) => selectRecent(claimed, now),
        // Step 3. 送る (鍵がなければ送らない)
        (recent): NewNotifiedEvt | ResultAsync<NewNotifiedEvt, AppError> => {
          if (recent.length === 0) return { type: "NoRecentVideos" };
          if (!vapid) return { type: "NoVapidKeys", videos: recent.length };
          return sendAll(buildPayload(recent), vapid, recent);
        },
      );
    },
  };
};
