import type { ClockPort, RandomPort } from "../shared/port.ts";
import type { MemberUsecase } from "./api.ts";
import type { InviteRepositoryPort } from "./invite/port.ts";
import { newInviteQueries } from "./invite/query.ts";
import { newInviteWorkFlows } from "./invite/workflow.ts";
import type {
  AvatarStoragePort,
  ProfileRepositoryPort,
} from "./profile/port.ts";
import { newProfileQueries } from "./profile/query.ts";
import { newProfileWorkFlows } from "./profile/workflow.ts";

/**
 * メンバー集約のユースケース. 招待 (invite/) と, プロフィール・ログイン (profile/) の
 * コマンド (workflow.ts) と Query (query.ts) をまとめる
 */
export const newMemberUsecase = (
  invite: InviteRepositoryPort,
  profile: ProfileRepositoryPort,
  avatar: AvatarStoragePort,
  clock: ClockPort,
  random: RandomPort,
): MemberUsecase => ({
  ...newInviteWorkFlows(invite, clock, random),
  ...newInviteQueries(invite, clock),
  ...newProfileWorkFlows(profile, avatar, clock, random),
  ...newProfileQueries(profile, avatar),
});
