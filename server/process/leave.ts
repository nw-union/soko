// メンバーの退会の後始末. auth.ts の deleteUser.afterDelete から呼ぶ.
// ポリシー（server/process/policy.ts の onMemberDeleted）で、各集約に自分のデータだけを消させる。
// auth.ts から辿られるので、相対 import には .ts を付けること
import { err, ok, type ResultAsync } from "@nw-union/nw-utils/lib/rslt";
import type { MemberDeletedEvt } from "../../domain/Member/api.ts";
import type { AppError } from "../../domain/shared/error.ts";
import { container } from "../container.ts";
import { log } from "../log/log.ts";
import { logAppError } from "../log/logger.ts";
import { onMemberDeleted } from "./policy.ts";

/**
 * 退会したメンバーのデータを各集約から消す. 失敗はすべてログに残し, 最初のエラーを返す
 */
export const runMemberDeleted = async (
  evt: MemberDeletedEvt,
): ResultAsync<void, AppError> => {
  const { memberUsecase, notificationUsecase, contentUsecase } = container();
  const failures = await onMemberDeleted(evt, [
    ({ userId, image }) => memberUsecase.cleanupDeletedUser({ userId, image }),
    ({ userId }) => notificationUsecase.unsubscribeAll({ userId }),
    ({ userId }) => contentUsecase.forgetWatches({ userId }),
  ]);
  for (const e of failures) logAppError(log(), e);
  return failures.length === 0 ? ok() : err(failures[0]);
};
