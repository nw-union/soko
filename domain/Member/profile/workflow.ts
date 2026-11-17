import {
  ok,
  type ResultAsync,
  sequence,
  stepAsync,
  throughAsync,
} from "@nw-union/nw-utils/lib/rslt";
import type { AppError } from "../../shared/error.ts";
import type { ClockPort, RandomPort } from "../../shared/port.ts";
import { newUserId } from "../../shared/vo.ts";
import type { MemberUsecase } from "../api.ts";
import {
  ensurePasskeyDeletable,
  validateImageFile,
  validateProfileInput,
  validateSignupEmail,
} from "./logic.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "./port.ts";
import type { ValidatedProfile } from "./type.ts";
import { createAvatarKey, parseAvatarPath, toAvatarPath } from "./vo.ts";

/**
 * プロフィール・ログインのユースケースのうち, コマンド. better-auth の手前のチェック (validate〜・check〜) もここに置く
 */
export const newProfileWorkFlows = (
  r: ProfileRepositoryPort,
  s: AvatarStoragePort,
  clock: ClockPort,
  random: RandomPort,
): Pick<
  MemberUsecase,
  | "validateProfileUpdate"
  | "validateSignUp"
  | "changeAvatar"
  | "removeAvatar"
  | "cleanupDeletedUser"
  | "checkPasskeyDeletion"
> => ({
  /**
   * プロフィールの更新で送られてきた値を確かめる
   */
  validateProfileUpdate: (cmd) =>
    stepAsync(
      // Step 1. バリデーション: Cmd -> ValidatedProfile
      validateProfileInput(cmd),
      // Step 2. イベント発行
      convToProfileEvt,
    ),

  /**
   * 登録で送られてきた値を確かめる
   */
  validateSignUp: ({ email, ...profile }) =>
    stepAsync(
      // Step 1. メールアドレスの確認 (使い捨てのものだけ)
      validateSignupEmail(email),
      // Step 2. バリデーション: Cmd -> ValidatedProfile
      () => validateProfileInput(profile),
      // Step 3. イベント発行
      convToProfileEvt,
    ),

  /**
   * アイコン画像を差し替える
   */
  changeAvatar: ({ userId, file }) =>
    stepAsync(
      // Step 1. バリデーション: [string, Uint8Array | null] -> [UserId, ImageFile]
      sequence([newUserId(userId), validateImageFile(file)]),
      // Step 2. ストレージに保存: [UserId, ImageFile] -> [UserId, AvatarKey]
      ([user, f]) => {
        const key = createAvatarKey(random.bytes(16), f.ext);
        return stepAsync(s.putAvatar(key, f), () => [user, key] as const);
      },
      // Step 3. DB 保存 (古い画像を覚えておく): [UserId, AvatarKey] -> [string, string | null]
      ([user, key]) =>
        stepAsync(
          r.readImage(user),
          throughAsync(() =>
            r.updateImage(user, toAvatarPath(key), clock.now()),
          ),
          (old) => [toAvatarPath(key), old] as const,
        ),
      // Step 4. 古い画像を消す (失敗しても差し替えは成功させる)
      throughAsync(([, old]) => removeOldAvatar(s)(old)),
      // Step 5. イベント発行
      ([image]) => ({ image }),
    ),

  /**
   * アイコン画像を外す
   */
  removeAvatar: ({ userId }) =>
    stepAsync(
      // Step 1. バリデーション: string -> UserId
      newUserId(userId),
      // Step 2. DB 保存 (古い画像を覚えておく): UserId -> string | null
      (user) =>
        stepAsync(
          r.readImage(user),
          throughAsync(() => r.updateImage(user, null, clock.now())),
        ),
      // Step 3. 古い画像を消す (失敗しても外すのは成功させる)
      removeOldAvatar(s),
    ),

  /**
   * 退会したユーザーの後始末
   */
  cleanupDeletedUser: ({ userId, image }) =>
    stepAsync(
      // Step 1. バリデーション: string -> UserId
      newUserId(userId),
      // Step 2. アイコン画像を消す (失敗しても続ける)
      throughAsync(() => removeOldAvatar(s)(image)),
      // Step 3. DB 削除
      r.deleteUserData,
    ),

  /**
   * パスキーを削除してよいか確かめる
   */
  checkPasskeyDeletion: async ({ sessionCreatedAt, passkeyCount }) =>
    ensurePasskeyDeletable(sessionCreatedAt, passkeyCount, clock.now()),
});

/**
 * このアプリで保存したアイコン画像なら, ストレージから消す. 失敗しても成功として扱う
 */
const removeOldAvatar =
  (s: AvatarStoragePort) =>
  async (image: unknown): ResultAsync<void, AppError> => {
    const key = parseAvatarPath(image);
    if (key) await s.deleteAvatar(key);
    return ok();
  };

const convToProfileEvt = (p: ValidatedProfile) => ({
  ...(p.name !== undefined && { name: p.name as string }),
  ...(p.color !== undefined && { color: p.color as string | null }),
});
