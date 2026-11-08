import { okAsync } from "neverthrow";
import type { NotificationQueries } from "../../schema/service.ts";
import type { VapidKeys } from "./type.ts";

/**
 * 通知集約の Queries (Read Model)
 *
 * @param vapid - VAPID の鍵. どれかが未設定なら null (通知の機能を使わない)
 */
export const newNotificationQueries = (
  vapid: VapidKeys | null,
): NotificationQueries => ({
  /**
   * 購読に使う VAPID の公開鍵
   */
  getPublicKey: () => okAsync({ publicKey: vapid?.publicKey ?? null }),
});
