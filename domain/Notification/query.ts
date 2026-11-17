import { ok } from "@nw-union/nw-utils/lib/rslt";
import type { NotificationUsecase } from "./api.ts";
import type { VapidKeys } from "./type.ts";

/**
 * 通知集約のユースケースのうち, Query (Read Model. 読むだけ)
 *
 * @param vapid - VAPID の鍵. どれかが未設定なら null (通知の機能を使わない)
 */
export const newNotificationQueries = (
  vapid: VapidKeys | null,
): Pick<NotificationUsecase, "getPublicKey"> => ({
  /**
   * 購読に使う VAPID の公開鍵
   */
  getPublicKey: async () => ok({ publicKey: vapid?.publicKey ?? null }),
});
