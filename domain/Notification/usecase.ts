import type { ClockPort } from "../shared/port.ts";
import type { NotificationUsecase } from "./api.ts";
import type {
  BadgeCounterPort,
  PushRepositoryPort,
  PushSenderPort,
} from "./port.ts";
import { newNotificationQueries } from "./query.ts";
import type { VapidKeys } from "./type.ts";
import { newNotificationWorkFlows } from "./workflow.ts";

/**
 * 通知集約のユースケース. コマンド (workflow.ts) と Query (query.ts) をまとめる
 *
 * @param vapid - VAPID の鍵. どれかが未設定なら null (通知の機能を使わない)
 */
export const newNotificationUsecase = (
  r: PushRepositoryPort,
  sender: PushSenderPort,
  badge: BadgeCounterPort,
  clock: ClockPort,
  vapid: VapidKeys | null,
): NotificationUsecase => ({
  ...newNotificationWorkFlows(r, sender, badge, clock, vapid),
  ...newNotificationQueries(vapid),
});
