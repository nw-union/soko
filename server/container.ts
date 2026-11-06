// Composition Root。ドメインの WorkFlows に、実際の adapter を組み込む。
// 作るのは軽いクロージャだけなので、ハンドラの中で毎回 container() を呼んでよい。
// auth.ts からも読み込まれるので（Void の CLI は拡張子なしの相対 import を解決できない）、相対 import には .ts を付けること
import { db } from "void/db";
import { newInviteRepository } from "../adapter/drizzle/invite.ts";
import { cryptoRandom, systemClock } from "../adapter/system.ts";
import { newInviteWorkFlows } from "../domain/Invite/workflow.ts";

export const container = () => ({
  inviteWorkFlows: newInviteWorkFlows(
    newInviteRepository(db),
    systemClock,
    cryptoRandom,
  ),
});
