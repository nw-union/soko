import { sequenceAsync, stepAsync } from "@nw-union/nw-utils/lib/rslt";
import type { ClockPort } from "../../shared/port.ts";
import { newUserId } from "../../shared/vo.ts";
import type { MemberUsecase } from "../api.ts";
import { convToInviteDto, limitOf, remainingOf } from "./logic.ts";
import type { InviteRepositoryPort } from "./port.ts";

/**
 * 招待のユースケースのうち, Query (Read Model)
 */
export const newInviteQueries = (
  r: InviteRepositoryPort,
  clock: ClockPort,
): Pick<MemberUsecase, "listInvites"> => ({
  /**
   * 自分が発行した招待の一覧と, あと何回発行できるか
   */
  listInvites: ({ userId }) =>
    stepAsync(
      // Step 1. バリデーション: string -> UserId
      newUserId(userId),
      // Step 2. 一覧と利用状況の取得: UserId -> [IssuedInvite[], InviteUsage]
      (inviter) =>
        sequenceAsync([
          r.listInvites(inviter),
          r.readUsage(inviter, clock.now()),
        ]),
      // Step 3. View に組み立てる
      ([invites, usage]) => ({
        limit: limitOf(usage),
        remaining: remainingOf(usage),
        invites: invites.map(convToInviteDto),
      }),
    ),
});
