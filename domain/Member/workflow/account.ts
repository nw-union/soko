// ワークフロー: アカウント (CheckPasskeyDeletion パスキーを削除してよいか確かめる・CheckOAuthConsent 外部のアプリへの許可を受け付けてよいか確かめる・CleanupDeletedUser 退会したユーザーの後始末をする・パスキーを作ったか)
import { match } from "@nw-union/nw-utils/lib/match";
import {
  err,
  ok,
  type Result,
  stepAsync,
  throughAsync,
} from "@nw-union/nw-utils/lib/rslt";
import {
  type ForbiddenError,
  newForbiddenError,
  newValidationErrorWithMessage,
  type ValidationError,
} from "../../shared/error.ts";
import type { ClockPort } from "../../shared/port.ts";
import { newUserId } from "../../shared/vo.ts";
import type { MemberUsecase } from "../api.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "../port.ts";
import { removeOldAvatar } from "./avatar.ts";

/**
 * ログイン (登録) から何秒までのセッションを「新しい」とみなすか.
 * パスキーの追加・削除とアカウントの削除は, この時間内にパスキーでログインし直したセッションでだけ受け付ける
 * (セッションが盗まれても, パスキーを差し替えて乗っ取られないように). 登録直後の /welcome でのパスキー作成もこの時間内に行う
 */
export const FRESH_AGE_SECONDS = 10 * 60;

// ----------------------------------------------------------------------------
// 依存
// ----------------------------------------------------------------------------
type AccountRepository = Pick<
  ProfileRepositoryPort,
  "countPasskeys" | "deleteUserData"
>;

// ----------------------------------------------------------------------------
// Step: セッションの新しさの確認
// ----------------------------------------------------------------------------
/**
 * ログインし直したばかりのセッションか確かめる. 古ければ ForbiddenError (code: SESSION_NOT_FRESH)
 */
export const ensureFreshSession = (
  sessionCreatedAt: Date,
  now: Date,
): Result<void, ForbiddenError> =>
  now.getTime() - sessionCreatedAt.getTime() >= FRESH_AGE_SECONDS * 1000
    ? err(newForbiddenError("Session is not fresh", "SESSION_NOT_FRESH"))
    : ok(undefined);

// ----------------------------------------------------------------------------
// Step: パスキーの削除の確認
// ----------------------------------------------------------------------------
/**
 * パスキーを削除してよいか確かめる
 *
 * - ログインし直したばかりのセッションだけが削除できる (パスキーの追加と同じ)
 * - 最後のパスキーは削除できない (ログインできなくなるため)
 */
export const ensurePasskeyDeletable = (
  sessionCreatedAt: Date,
  passkeyCount: number,
  now: Date,
): Result<void, ForbiddenError | ValidationError> =>
  match(ensureFreshSession(sessionCreatedAt, now))
    .ok(
      (): Result<void, ValidationError> =>
        passkeyCount <= 1
          ? err(
              newValidationErrorWithMessage(
                "passkey",
                "最後のパスキーは削除できません（ログインできなくなります）",
              ),
            )
          : ok(undefined),
    )
    .err((e): Result<void, ForbiddenError> => err(e))
    .exhaustive();

// ----------------------------------------------------------------------------
// 実装
// ----------------------------------------------------------------------------
/**
 * アカウント (パスキーと退会). better-auth の手前のチェック (check〜) もここに置く
 */
export const newAccountWorkflow = (
  r: AccountRepository,
  s: Pick<AvatarStoragePort, "deleteAvatar">,
  clock: ClockPort,
): Pick<
  MemberUsecase,
  | "checkPasskeyDeletion"
  | "checkOAuthConsent"
  | "cleanupDeletedUser"
  | "hasPasskey"
> => ({
  /**
   * パスキーを削除してよいか確かめる
   */
  checkPasskeyDeletion: async ({ sessionCreatedAt, passkeyCount }) =>
    ensurePasskeyDeletable(sessionCreatedAt, passkeyCount, clock.now()),

  /**
   * 外部のアプリ (MCP のクライアント) への許可を受け付けてよいか確かめる.
   * 長く使えるリフレッシュトークンを渡すので, パスキーの追加と同じく, ログインし直したばかりのセッションだけにする
   */
  checkOAuthConsent: async ({ sessionCreatedAt }) =>
    ensureFreshSession(sessionCreatedAt, clock.now()),

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
   * パスキーを作ったか
   */
  hasPasskey: ({ userId }) =>
    stepAsync(
      // Step 1. バリデーション: string -> UserId
      newUserId(userId),
      // Step 2. 数える
      r.countPasskeys,
      // Step 3. View に組み立てる
      (count) => ({ hasPasskey: count > 0 }),
    ),
});
