import { okAsync, ResultAsync } from "neverthrow";
import type { MemberQueries } from "../../../schema/service.ts";
import type { ClockPort } from "../../port.ts";
import { newUserId } from "../../vo.ts";
import { limitOf, remainingOf } from "./logic.ts";
import type { InviteRepositoryPort } from "./port.ts";

/**
 * 招待の Queries (Read Model)
 */
export const newInviteQueries = (
  r: InviteRepositoryPort,
  clock: ClockPort,
): Pick<MemberQueries, "listInvites"> => ({
  /**
   * 自分が発行した招待の一覧と, あと何回発行できるか
   */
  listInvites: ({ userId }) =>
    okAsync(userId)
      // Step 1. バリデーション: string -> UserId
      .andThen((id) => newUserId(id))
      // Step 2. 一覧と利用状況の取得: UserId -> [InviteDto[], InviteUsage]
      .andThen((inviter) =>
        ResultAsync.combine([
          r.listInvites(inviter),
          r.readUsage(inviter, clock.now()),
        ]),
      )
      // Step 3. View に組み立てる
      .map(([invites, usage]) => ({
        limit: limitOf(usage),
        remaining: remainingOf(usage),
        invites,
      })),
});
