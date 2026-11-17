import type { ClockPort, RandomPort } from "../shared/port.ts";
import type { MemberUsecase } from "./api.ts";
import type {
  AvatarStoragePort,
  InviteRepositoryPort,
  ProfileRepositoryPort,
} from "./port.ts";
import { newAccountWorkflow } from "./workflow/account.ts";
import { newAvatarWorkflow } from "./workflow/avatar.ts";
import { newInviteWorkflow } from "./workflow/invite.ts";
import { newProfileWorkflow } from "./workflow/profile.ts";

/**
 * メンバー集約のユースケース. workflow/ のワークフローに依存を渡してまとめる
 */
export const newMemberUsecase = (
  invite: InviteRepositoryPort,
  profile: ProfileRepositoryPort,
  avatar: AvatarStoragePort,
  clock: ClockPort,
  random: RandomPort,
): MemberUsecase => ({
  ...newInviteWorkflow(invite, clock, random),
  ...newProfileWorkflow(),
  ...newAvatarWorkflow(profile, avatar, clock, random),
  ...newAccountWorkflow(profile, avatar, clock),
});
