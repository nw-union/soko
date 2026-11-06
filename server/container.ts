// Composition Root。ドメインの WorkFlows に、実際の adapter を組み込む。
// 作るのは軽いクロージャだけなので、ハンドラの中で毎回 container() を呼んでよい。
// auth.ts からも読み込まれるので（Void の CLI は拡張子なしの相対 import を解決できない）、相対 import には .ts を付けること
import { db } from "void/db";
import { env } from "void/env";
import { storage } from "void/storage";
import { newCatalogRepository } from "../adapter/drizzle/catalog.ts";
import { newFeedRepository } from "../adapter/drizzle/feed.ts";
import { newInviteRepository } from "../adapter/drizzle/invite.ts";
import { newProfileRepository } from "../adapter/drizzle/profile.ts";
import { newPushRepository } from "../adapter/drizzle/push.ts";
import { newAvatarStorage } from "../adapter/r2/avatar.ts";
import { cryptoRandom, systemClock } from "../adapter/system.ts";
import { webPushSender } from "../adapter/webpush/sender.ts";
import { newYoutubeApi } from "../adapter/youtube/api.ts";
import { newCatalogWorkFlows } from "../domain/Catalog/workflow.ts";
import { newFeedWorkFlows } from "../domain/Feed/workflow.ts";
import { newInviteWorkFlows } from "../domain/Invite/workflow.ts";
import { newProfileWorkFlows } from "../domain/Profile/workflow.ts";
import type { VapidKeys } from "../domain/Push/type.ts";
import { newPushWorkFlows } from "../domain/Push/workflow.ts";

// VAPID の鍵（新着動画のプッシュ通知）。どれかが未設定なら null（通知を送らず、プロフィールにも通知の設定を出さない）
const vapidKeys = (): VapidKeys | null =>
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      }
    : null;

export const container = () => {
  const feedWorkFlows = newFeedWorkFlows(newFeedRepository(db), cryptoRandom);
  return {
    // 動画の自動取得。YOUTUBE_API_KEY が未設定なら取得しない（アプリは動く）。取得するプレイリストは DB の playlists に登録する
    catalogWorkFlows: newCatalogWorkFlows(
      newCatalogRepository(db),
      env.YOUTUBE_API_KEY ? newYoutubeApi(env.YOUTUBE_API_KEY) : null,
    ),
    feedWorkFlows,
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
    pushWorkFlows: newPushWorkFlows(
      newPushRepository(db),
      webPushSender,
      // バッジの本数は Feed のものを使う
      {
        countUnwatchedNew: (userIds) =>
          feedWorkFlows.countUnwatchedNew({ userIds }).map((e) => e.counts),
      },
      systemClock,
      vapidKeys(),
    ),
  };
};
