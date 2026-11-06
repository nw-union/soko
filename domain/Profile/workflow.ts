import { okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "../../error.ts";
import type { ProfileWorkFlows } from "../../schema/service.ts";
import type { ClockPort, RandomPort } from "../port.ts";
import { newUserId } from "../vo.ts";
import {
  ensurePasskeyDeletable,
  resolveColor,
  resolveImage,
  validateImageFile,
  validateProfileInput,
  validateSignupEmail,
} from "./logic.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "./port.ts";
import type { ValidatedProfile } from "./type.ts";
import { createAvatarKey, parseAvatarPath, toAvatarPath } from "./vo.ts";

export const newProfileWorkFlows = (
  r: ProfileRepositoryPort,
  s: AvatarStoragePort,
  clock: ClockPort,
  random: RandomPort,
): ProfileWorkFlows => ({
  /**
   * プロフィールの更新で送られてきた値を確かめる
   */
  validateProfileUpdate: (cmd) =>
    okAsync(cmd)
      // Step 1. バリデーション: Cmd -> ValidatedProfile
      .andThen(validateProfileInput)
      // Step 2. イベント発行
      .map(convToProfileEvt),

  /**
   * 登録で送られてきた値を確かめる
   */
  validateSignUp: ({ email, ...profile }) =>
    okAsync(email)
      // Step 1. メールアドレスの確認 (使い捨てのものだけ)
      .andThen(validateSignupEmail)
      // Step 2. バリデーション: Cmd -> ValidatedProfile
      .andThen(() => validateProfileInput(profile))
      // Step 3. イベント発行
      .map(convToProfileEvt),

  /**
   * 画面に出すユーザー
   */
  getDisplayUser: ({ user }) =>
    okAsync({
      name: user.name,
      color: resolveColor(user.color, user.id),
      image: resolveImage(user.image),
    }),

  /**
   * パスキーを作ったか
   */
  hasPasskey: ({ userId }) =>
    okAsync(userId)
      // Step 1. バリデーション: string -> UserId
      .andThen((id) => newUserId(id))
      // Step 2. 数える
      .andThen(r.countPasskeys)
      // Step 3. イベント発行
      .map((count) => ({ hasPasskey: count > 0 })),

  /**
   * アイコン画像を差し替える
   */
  changeAvatar: ({ userId, file }) =>
    // Step 1. バリデーション: [string, Uint8Array | null] -> [UserId, ImageFile]
    okAsync(undefined)
      .andThen(() => newUserId(userId))
      .andThen((user) => validateImageFile(file).map((f) => [user, f] as const))
      // Step 2. ストレージに保存: [UserId, ImageFile] -> [UserId, AvatarKey]
      .andThen(([user, f]) => {
        const key = createAvatarKey(random.bytes(16), f.ext);
        return s.putAvatar(key, f).map(() => [user, key] as const);
      })
      // Step 3. DB 保存 (古い画像を覚えておく): [UserId, AvatarKey] -> [string, string | null]
      .andThen(([user, key]) =>
        r
          .readImage(user)
          .andThen((old) =>
            r
              .updateImage(user, toAvatarPath(key), clock.now())
              .map(() => [toAvatarPath(key), old] as const),
          ),
      )
      // Step 4. 古い画像を消す (失敗しても差し替えは成功させる)
      .andThrough(([, old]) => removeOldAvatar(s)(old))
      // Step 5. イベント発行
      .map(([image]) => ({ image })),

  /**
   * アイコン画像を外す
   */
  removeAvatar: ({ userId }) =>
    okAsync(userId)
      // Step 1. バリデーション: string -> UserId
      .andThen((id) => newUserId(id))
      // Step 2. DB 保存 (古い画像を覚えておく): UserId -> string | null
      .andThen((user) =>
        r
          .readImage(user)
          .andThrough(() => r.updateImage(user, null, clock.now())),
      )
      // Step 3. 古い画像を消す (失敗しても外すのは成功させる)
      .andThen(removeOldAvatar(s)),

  /**
   * 退会したユーザーの後始末
   */
  cleanupDeletedUser: ({ userId, image }) =>
    okAsync(userId)
      // Step 1. バリデーション: string -> UserId
      .andThen((id) => newUserId(id))
      // Step 2. アイコン画像を消す (失敗しても続ける)
      .andThrough(() => removeOldAvatar(s)(image))
      // Step 3. DB 削除
      .andThen(r.deleteUserData),

  /**
   * パスキーを削除してよいか確かめる
   */
  checkPasskeyDeletion: ({ sessionCreatedAt, passkeyCount }) =>
    okAsync(undefined).andThen(() =>
      ensurePasskeyDeletable(sessionCreatedAt, passkeyCount, clock.now()),
    ),
});

/**
 * このアプリで保存したアイコン画像なら, ストレージから消す. 失敗しても成功として扱う
 */
const removeOldAvatar =
  (s: AvatarStoragePort) =>
  (image: unknown): ResultAsync<void, AppError> => {
    const key = parseAvatarPath(image);
    return key
      ? s.deleteAvatar(key).orElse(() => okAsync(undefined))
      : okAsync(undefined);
  };

const convToProfileEvt = (p: ValidatedProfile) => ({
  ...(p.name !== undefined && { name: p.name as string }),
  ...(p.color !== undefined && { color: p.color as string | null }),
});
