import type { ClockPort } from "../shared/port.ts";
import type { NotificationUsecase } from "./api.ts";
import type {
  BadgeCounterPort,
  PushRepositoryPort,
  PushSenderPort,
} from "./port.ts";
import type { VapidKeys } from "./type.ts";
import { newNotifyWorkflow } from "./workflow/notify.ts";
import { newSubscriptionWorkflow } from "./workflow/subscription.ts";

/**
 * 通知集約のユースケース. workflow/ のワークフローに依存を渡してまとめる
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
  ...newSubscriptionWorkflow(r, vapid),
  ...newNotifyWorkflow(r, sender, badge, clock, vapid),
});
