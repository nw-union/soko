import type { ClockPort, RandomPort } from "../shared/port.ts";
import type { MemberWorkFlows } from "./api.ts";
import type { InviteRepositoryPort } from "./invite/port.ts";
import { newInviteWorkFlows } from "./invite/workflow.ts";
import type {
  AvatarStoragePort,
  ProfileRepositoryPort,
} from "./profile/port.ts";
import { newProfileWorkFlows } from "./profile/workflow.ts";

/**
 * メンバー集約の WorkFlows (コマンド). 招待の Invite と、プロフィール・ログインの Profile をまとめる
 */
export const newMemberWorkFlows = (
  invite: InviteRepositoryPort,
  profile: ProfileRepositoryPort,
  avatar: AvatarStoragePort,
  clock: ClockPort,
  random: RandomPort,
): MemberWorkFlows => ({
  ...newInviteWorkFlows(invite, clock, random),
  ...newProfileWorkFlows(profile, avatar, clock, random),
});
