// Composition Root。ドメインの WorkFlows に、実際の adapter を組み込む。
// 作るのは軽いクロージャだけなので、ハンドラの中で毎回 container() を呼んでよい。
// auth.ts からも読み込まれるので（Void の CLI は拡張子なしの相対 import を解決できない）、相対 import には .ts を付けること
import { db } from "void/db";
import { storage } from "void/storage";
import { newFeedRepository } from "../adapter/drizzle/feed.ts";
import { newInviteRepository } from "../adapter/drizzle/invite.ts";
import { newProfileRepository } from "../adapter/drizzle/profile.ts";
import { newAvatarStorage } from "../adapter/r2/avatar.ts";
import { cryptoRandom, systemClock } from "../adapter/system.ts";
import { newFeedWorkFlows } from "../domain/Feed/workflow.ts";
import { newInviteWorkFlows } from "../domain/Invite/workflow.ts";
import { newProfileWorkFlows } from "../domain/Profile/workflow.ts";

export const container = () => ({
  feedWorkFlows: newFeedWorkFlows(newFeedRepository(db), cryptoRandom),
  inviteWorkFlows: newInviteWorkFlows(
    newInviteRepository(db),
    systemClock,
    cryptoRandom,
  ),
  profileWorkFlows: newProfileWorkFlows(
    newProfileRepository(db),
    newAvatarStorage(storage),
    systemClock,
    cryptoRandom,
  ),
});
