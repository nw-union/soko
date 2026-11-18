import type { ResultAsync } from "@nw-union/nw-utils/lib/rslt";
import type { AppError } from "../shared/error.ts";
import type { UserId } from "../shared/vo.ts";
import type {
  AvatarFile,
  ConnectedApp,
  ImageFile,
  InviteUsage,
  IssuedInvite,
  NewInvite,
} from "./type.ts";
import type { AvatarKey, InviteId, OAuthClientId, TokenHash } from "./vo.ts";

// ----------------------------------------------------------------------------
// 招待
// ----------------------------------------------------------------------------
/**
 * 招待のリポジトリ
 *
 * 「使える招待」は, 未使用で, 期限がないか now より後のもの.
 * 「数える招待」(発行上限に数えるもの) は, 使用済みか, まだ使えるもの. 期限切れで未使用の招待は数えない (枠が戻る).
 *
 * insertInviteIfUnderLimit と claimInvite は, 確認と書き込みを 1 つの操作で行うこと
 * (読んでから書くと, 同時に押されたときに上限を超えたり, 1 つの招待で 2 人が登録できたりする)
 */
export interface InviteRepositoryPort {
  // inviter が発行した招待の一覧 (新しい順)
  listInvites(inviter: UserId): ResultAsync<IssuedInvite[], AppError>;

  // inviter の上限と, 数える招待の数
  readUsage(inviter: UserId, now: Date): ResultAsync<InviteUsage, AppError>;

  // 数える招待が上限 (user.inviteLimit, なければ defaultLimit) 未満のときだけ保存する. 保存したら true
  insertInviteIfUnderLimit(
    invite: NewInvite,
    defaultLimit: number,
    now: Date,
  ): ResultAsync<boolean, AppError>;

  // inviter が発行した未使用の招待を消す. 当てはまるものがなくても成功
  deleteUnusedInvite(
    id: InviteId,
    inviter: UserId,
  ): ResultAsync<void, AppError>;

  // 使える招待か
  isUsableInvite(hash: TokenHash, now: Date): ResultAsync<boolean, AppError>;

  // 使える招待なら, 使用済み (used_at = now) にする. 使用済みにしたら true
  claimInvite(hash: TokenHash, now: Date): ResultAsync<boolean, AppError>;

  // 招待を使ったユーザーを記録する
  setInvitedUser(hash: TokenHash, user: UserId): ResultAsync<void, AppError>;
}

// ----------------------------------------------------------------------------
// プロフィール・アイコン画像
// ----------------------------------------------------------------------------
/**
 * ユーザーのリポジトリ (user・passkey テーブルは better-auth が管理している. ここで触るのは user.image とパスキーの数だけ)
 */
export interface ProfileRepositoryPort {
  // ユーザーのパスキーの数 (passkey テーブルは better-auth が管理している)
  countPasskeys(user: UserId): ResultAsync<number, AppError>;

  // ユーザーがいるか (退会していないか)
  existsUser(user: UserId): ResultAsync<boolean, AppError>;

  // user.image. ユーザーがいなければ null
  readImage(user: UserId): ResultAsync<string | null, AppError>;

  // user.image を差し替え, updatedAt を now にする
  updateImage(
    user: UserId,
    image: string | null,
    now: Date,
  ): ResultAsync<void, AppError>;

  // 退会したユーザーのデータを消す: 発行した未使用の招待, 通知の購読, 視聴記録.
  // 使用済みの招待の記録は残す. パスキー・セッションは better-auth が user に連動して消す
  deleteUserData(user: UserId): ResultAsync<void, AppError>;
}

/**
 * アイコン画像のストレージ
 */
export interface AvatarStoragePort {
  putAvatar(key: AvatarKey, file: ImageFile): ResultAsync<void, AppError>;
  deleteAvatar(key: AvatarKey): ResultAsync<void, AppError>;
  // 保存されている画像. なければ null
  getAvatar(key: AvatarKey): ResultAsync<AvatarFile | null, AppError>;
}

// ----------------------------------------------------------------------------
// 外部のアプリ (OAuth のクライアント)
// ----------------------------------------------------------------------------
/**
 * 接続中のアプリのリポジトリ (oauthConsent・oauthRefreshToken・oauthAccessToken・oauthClient は better-auth の oauth-provider が管理している)
 */
export interface ConnectionRepositoryPort {
  // user が許可したアプリの一覧 (許可した日時の新しい順)
  listConnectedApps(user: UserId): ResultAsync<ConnectedApp[], AppError>;

  // user が client に与えた許可を取り消す. 同意と, リフレッシュトークン・アクセストークンの記録を消す.
  // 当てはまるものがなくても成功. 発行済みの JWT のアクセストークンは期限 (1 時間) まで使える
  deleteGrant(user: UserId, client: OAuthClientId): ResultAsync<void, AppError>;
}
