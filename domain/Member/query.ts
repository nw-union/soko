import type { ClockPort } from "../shared/port.ts";
import type { MemberQueries } from "./api.ts";
import type { InviteRepositoryPort } from "./invite/port.ts";
import { newInviteQueries } from "./invite/query.ts";
import type { ProfileRepositoryPort } from "./profile/port.ts";
import { newProfileQueries } from "./profile/query.ts";

/**
 * メンバー集約の Queries (Read Model). 招待の Invite と、プロフィール・ログインの Profile をまとめる
 */
export const newMemberQueries = (
  invite: InviteRepositoryPort,
  profile: ProfileRepositoryPort,
  clock: ClockPort,
): MemberQueries => ({
  ...newInviteQueries(invite, clock),
  ...newProfileQueries(profile),
});
