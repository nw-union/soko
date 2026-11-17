// ワークフロー: 新着の通知 (NotifyNew 新着を通知する)
import { okAsync, ResultAsync } from "neverthrow";
import type { AppError } from "../../shared/error.ts";
import type { ClockPort } from "../../shared/port.ts";
import type { NewNotifiedEvt, NotificationUsecase } from "../api.ts";
import type {
  BadgeCounterPort,
  PushRepositoryPort,
  PushSenderPort,
} from "../port.ts";
import type {
  ClaimedVideo,
  PushPayload,
  SendResult,
  StoredSubscription,
  VapidKeys,
} from "../type.ts";

// ----------------------------------------------------------------------------
// 依存
// ----------------------------------------------------------------------------
type NotifyRepository = Pick<
  PushRepositoryPort,
  "listSubscriptions" | "deleteSubscriptions" | "claimUnnotifiedVideos"
>;

/**
 * 投稿からこれより古い動画は, 新しく取り込んでも通知しない.
 * プレイリストを追加したときなどに, 昔の動画の通知がまとめて届かないように
 */
export const RECENT_DAYS = 3;

// プッシュの本文は 4KB まで. 暗号化の分を見込んで, 本文は短く切る
const BODY_MAX = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------
// Step: 通知する動画と中身・送信の結果
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
// 実装
// ----------------------------------------------------------------------------
/**
 * 新着動画の通知
 *
 * @param vapid - VAPID の鍵. どれかが未設定なら null (通知の機能を使わない)
 */
export const newNotifyWorkflow = (
  r: NotifyRepository,
  sender: PushSenderPort,
  badge: BadgeCounterPort,
  clock: ClockPort,
  vapid: VapidKeys | null,
): Pick<NotificationUsecase, "notifyNew"> => {
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
