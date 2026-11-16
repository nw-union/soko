// Composition Root。ドメインの …Usecase（ContentUsecase・MemberUsecase・NotificationUsecase）に、実際の adapter を組み込む。
// 作るのは軽いクロージャだけなので、ハンドラの中で毎回 container() を呼んでよい。
// auth.ts からも読み込まれるので（Void の CLI は拡張子なしの相対 import を解決できない）、相対 import には .ts を付けること
import { db } from "void/db";
import { env } from "void/env";
import { storage } from "void/storage";
import { newContentRepository } from "../adapter/drizzle/content.ts";
import { newInviteRepository } from "../adapter/drizzle/invite.ts";
import { newProfileRepository } from "../adapter/drizzle/profile.ts";
import { newPushRepository } from "../adapter/drizzle/push.ts";
import { newAvatarStorage } from "../adapter/r2/avatar.ts";
import { cryptoRandom, systemClock } from "../adapter/system.ts";
import { webPushSender } from "../adapter/webpush/sender.ts";
import { newYoutubeApi } from "../adapter/youtube/api.ts";
import { newContentUsecase } from "../domain/Content/usecase.ts";
import { newMemberUsecase } from "../domain/Member/usecase.ts";
import type { VapidKeys } from "../domain/Notification/type.ts";
import { newNotificationUsecase } from "../domain/Notification/usecase.ts";

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
  const contentRepository = newContentRepository(db);
  const inviteRepository = newInviteRepository(db);
  const profileRepository = newProfileRepository(db);
  const avatarStorage = newAvatarStorage(storage);
  const vapid = vapidKeys();
  // コンテンツ集約: 動画の自動取得・プレイリストの登録・視聴記録と、ホーム・バッジの本数・プレイリストの一覧。
  // YOUTUBE_API_KEY が未設定なら取得しない（アプリは動く）。取得するプレイリストは DB の playlists に登録する
  const contentUsecase = newContentUsecase(
    contentRepository,
    env.YOUTUBE_API_KEY ? newYoutubeApi(env.YOUTUBE_API_KEY) : null,
    cryptoRandom,
  );
  return {
    contentUsecase,
    // メンバー集約: 招待（Invite）と、プロフィール・ログイン（Profile）
    memberUsecase: newMemberUsecase(
      inviteRepository,
      profileRepository,
      avatarStorage,
      systemClock,
      cryptoRandom,
    ),
    // 通知集約: Web Push の購読と、新着動画の通知
    notificationUsecase: newNotificationUsecase(
      newPushRepository(db),
      webPushSender,
      // バッジの本数はコンテンツ集約の Read Model を使う
      {
        countUnwatchedNew: (userIds) =>
          contentUsecase.countUnwatchedNew({ userIds }).map((v) => v.counts),
      },
      systemClock,
      vapid,
    ),
  };
};
