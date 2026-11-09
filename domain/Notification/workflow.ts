import { okAsync, ResultAsync } from "neverthrow";
import type { AppError } from "../shared/error.ts";
import type { ClockPort } from "../shared/port.ts";
import { newUserId } from "../shared/vo.ts";
import type { NewNotifiedEvt, NotificationWorkFlows } from "./api.ts";
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
 * 通知集約の WorkFlows (コマンド). Web Push の購読と, 新着動画の通知
 *
 * @param vapid - VAPID の鍵. どれかが未設定なら null (通知の機能を使わない)
 */
export const newNotificationWorkFlows = (
  r: PushRepositoryPort,
  sender: PushSenderPort,
  badge: BadgeCounterPort,
  clock: ClockPort,
  vapid: VapidKeys | null,
): NotificationWorkFlows => {
  /**
   * 全購読者に送る. 1 件ずつの失敗では止めない
   */
  const sendAll = (
    payload: PushPayload,
    keys: VapidKeys,
    recent: ClaimedVideo[],
  ) =>
    // Step 1. 送り先と, バッジの本数の取得 (数えられなくても通知は送る)
    r
      .listSubscriptions()
      .andThen((subs) =>
        badge
          .countUnwatchedNew(subs.map((sub) => sub.userId))
          .map((counts) => ({
            subs,
            counts,
            badgeError: null as string | null,
          }))
          .orElse((e) =>
            okAsync({
              subs,
              counts: new Map<string, number>(),
              badgeError: `${e.type}: ${e.message}`,
            }),
          ),
      )
      // Step 2. 送信: 購読ごとに, バッジの本数を入れて送る
      .andThen(({ subs, counts, badgeError }) =>
        ResultAsync.combine(
          subs.map((sub) =>
            sendOne(sub, { ...payload, badge: counts.get(sub.userId) }, keys),
          ),
        ).map((results) => ({ subs, results, badgeError })),
      )
      // Step 3. 購読をやめた端末の購読を消す
      .andThen(({ subs, results, badgeError }) => {
        const gone = results.flatMap((res) =>
          res.type === "Gone" ? [res.subscriptionId] : [],
        );
        return (
          gone.length > 0 ? r.deleteSubscriptions(gone) : okAsync(undefined)
        ).map(
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
      });

  /**
   * 1 件送り, 結果にする. 送れなかったときも失敗の結果にする (他の購読への送信は続ける)
   */
  const sendOne = (
    sub: StoredSubscription,
    payload: PushPayload,
    keys: VapidKeys,
  ) =>
    sender
      .send(sub, payload, keys)
      .map((status) => classifySendResult(sub, status))
      .orElse((reason) =>
        okAsync<SendResult, never>({ type: "Failed", reason }),
      );

  return {
    /**
     * 購読を保存する
     */
    subscribe: ({ userId, body }) =>
      okAsync(userId)
        // Step 1. バリデーション: [string, unknown] -> NewSubscription
        .andThen((id) => newUserId(id))
        .andThen((user) => validateSubscription(user, body))
        // Step 2. DB 保存
        .andThrough(r.upsertSubscription)
        // Step 3. 古い購読を消す (1 人 MAX_SUBSCRIPTIONS_PER_USER 件まで)
        .andThen((sub) =>
          r.trimSubscriptions(sub.userId, MAX_SUBSCRIPTIONS_PER_USER),
        ),

    /**
     * 購読を消す
     */
    unsubscribe: ({ userId, endpoint }) =>
      // Step 1. バリデーション: [string, unknown] -> [UserId, string]
      okAsync(undefined)
        .andThen(() => newUserId(userId))
        .andThen((user) =>
          validateEndpointToDelete(endpoint).map((e) => [user, e] as const),
        )
        // Step 2. DB 削除
        .andThen(([user, e]) => r.deleteSubscription(user, e)),

    /**
     * 新着動画を通知する
     */
    notifyNew: () => {
      const now = clock.now();
      return (
        // Step 1. まだ通知していない動画を, 通知済みにする
        r
          .claimUnnotifiedVideos(now)
          // Step 2. 通知する動画を選ぶ (最近のものだけ)
          .map((claimed) => selectRecent(claimed, now))
          // Step 3. 送る (鍵がなければ送らない)
          .andThen((recent): ResultAsync<NewNotifiedEvt, AppError> => {
            if (recent.length === 0) return okAsync({ type: "NoRecentVideos" });
            if (!vapid)
              return okAsync({ type: "NoVapidKeys", videos: recent.length });
            return sendAll(buildPayload(recent), vapid, recent);
          })
      );
    },
  };
};
