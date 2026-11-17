// メンバー集約の入口の I/F（ユースケース）: MemberUsecase と、Cmd / Evt / Query / View / DTO。
// Web 層（pages/ routes/ crons/ auth.ts）は、ここに定義した型と server/container.ts の memberUsecase だけを使う。
// 入力（Cmd / Query）は画面や API から来た値のまま受け取り、検証はドメインで行う。
// 出口の I/F（副作用）は port.ts に置く
import type { ResultAsync } from "neverthrow";
import type { AppError } from "../shared/error.ts";

// ----------------------------------------------------------------------------
// Commands: 招待 (workflow/invite.ts)
// ----------------------------------------------------------------------------
/**
 * IssueInvite 招待を発行する
 *
 * 上限に達していれば ConflictError.
 * トークンはここで 1 回だけ返す (DB にはハッシュしか残らない)
 */
type IssueInvite = (
  cmd: IssueInviteCmd,
) => ResultAsync<IssueInviteEvt, AppError>;

export type IssueInviteCmd = { userId: string };
export type IssueInviteEvt = {
  // 画面に出す形 (XXXX-XXXX-XXXX-XXXX)
  token: string;
  // 有効日数
  days: number;
};

/**
 * RevokeInvite 招待を取り消す
 *
 * 未使用の招待を取り消す (枠が戻る). 使用済み・他人の招待・存在しない ID は何もしない
 */
type RevokeInvite = (cmd: RevokeInviteCmd) => ResultAsync<void, AppError>;

export type RevokeInviteCmd = {
  userId: string;
  // クエリ文字列のまま
  id: unknown;
};

/**
 * StartInvite 登録を始める
 *
 * 登録の入口. 招待トークンが今使えるか確かめ, 正規化したトークンを返す (Web 層が Cookie に入れる).
 * 使えない理由は教えない (形式違い・存在しない・使用済み・期限切れは, すべて同じ ValidationError)
 */
type StartInvite = (
  cmd: StartInviteCmd,
) => ResultAsync<StartInviteEvt, AppError>;

export type StartInviteCmd = { token: unknown };
export type StartInviteEvt = {
  // 正規化したトークン (大文字・ハイフンなし)
  token: string;
};

/**
 * ClaimInvite 招待を使う
 *
 * 登録 (ユーザー作成) の直前に, 招待を使用済みにする.
 * 同じトークンで同時に登録されても, 成功するのは 1 回だけ. 失敗の理由は startInvite と同じく教えない
 */
type ClaimInvite = (cmd: ClaimInviteCmd) => ResultAsync<void, AppError>;

export type ClaimInviteCmd = { token: unknown };

/**
 * LinkInvitedUser 招待にユーザーを結び付ける
 *
 * 登録 (ユーザー作成) の直後に, 使用済みにした招待へ, 作られたユーザーを結び付ける
 */
type LinkInvitedUser = (cmd: LinkInvitedUserCmd) => ResultAsync<void, AppError>;

export type LinkInvitedUserCmd = { token: unknown; userId: string };

// ----------------------------------------------------------------------------
// Commands: プロフィール・アイコン画像・アカウント (workflow/profile.ts・avatar.ts・account.ts)
// ----------------------------------------------------------------------------
/**
 * ValidateProfileUpdate プロフィールの更新を確かめる
 *
 * プロフィールの更新 (better-auth の update-user) で送られてきた値を確かめる.
 * 名前は前後の空白を除いて返す. 画像はここでは設定できない
 */
type ValidateProfileUpdate = (
  cmd: ValidateProfileCmd,
) => ResultAsync<ValidateProfileEvt, AppError>;

export type ValidateProfileCmd = {
  name?: unknown;
  color?: unknown;
  image?: unknown;
};
export type ValidateProfileEvt = {
  // 送られてこなかった項目は含めない (変更しない)
  name?: string;
  // null はイメージカラーを外す
  color?: string | null;
};

/**
 * ValidateSignUp 登録を確かめる
 *
 * 登録 (better-auth の sign-up) で送られてきた値を確かめる. メールアドレスは使い捨てのものだけ
 */
type ValidateSignUp = (
  cmd: ValidateSignUpCmd,
) => ResultAsync<ValidateProfileEvt, AppError>;

export type ValidateSignUpCmd = ValidateProfileCmd & { email: unknown };

/**
 * ChangeAvatar アイコン画像を差し替える
 *
 * 古い画像は消す (消せなくても差し替えは成功させる)
 */
type ChangeAvatar = (
  cmd: ChangeAvatarCmd,
) => ResultAsync<ChangeAvatarEvt, AppError>;

export type ChangeAvatarCmd = {
  userId: string;
  // アップロードされたファイルの中身. ファイルが送られてこなければ null
  file: Uint8Array | null;
};
export type ChangeAvatarEvt = {
  // user.image に入れたパス
  image: string;
};

/**
 * RemoveAvatar アイコン画像を外す
 *
 * アイコン画像を外して, 頭文字の表示に戻す
 */
type RemoveAvatar = (cmd: RemoveAvatarCmd) => ResultAsync<void, AppError>;

export type RemoveAvatarCmd = { userId: string };

/**
 * CleanupDeletedUser 退会したユーザーの後始末をする
 *
 * アイコン画像・未使用の招待・通知の購読・視聴記録を消す
 */
type CleanupDeletedUser = (
  cmd: CleanupDeletedUserCmd,
) => ResultAsync<void, AppError>;

export type CleanupDeletedUserCmd = { userId: string; image: unknown };

/**
 * CheckPasskeyDeletion パスキーを削除してよいか確かめる
 *
 * ログインし直したばかりでなければ ForbiddenError (code: SESSION_NOT_FRESH), 最後のパスキーなら ValidationError
 */
type CheckPasskeyDeletion = (
  cmd: CheckPasskeyDeletionCmd,
) => ResultAsync<void, AppError>;

export type CheckPasskeyDeletionCmd = {
  sessionCreatedAt: Date;
  passkeyCount: number;
};

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------
/**
 * 自分が発行した招待の一覧と, あと何回発行できるか
 */
type ListInvites = (q: ListInvitesQuery) => ResultAsync<InvitesView, AppError>;

export type ListInvitesQuery = { userId: string };
export type InvitesView = {
  limit: number;
  remaining: number;
  invites: InviteDto[];
};

/**
 * 画面に出すユーザー (全ページで共通に使う, 表示に必要な最小限)
 */
type GetDisplayUser = (
  q: GetDisplayUserQuery,
) => ResultAsync<DisplayUserDto, AppError>;

export type GetDisplayUserQuery = {
  user: { id: string; name: string; color?: unknown; image?: unknown };
};

/**
 * パスキーを作ったか. パスキーがログインの唯一の手段なので, まだ作っていない (登録の途中の) 人は /welcome から出さない
 */
type HasPasskey = (
  q: HasPasskeyQuery,
) => ResultAsync<PasskeyStatusView, AppError>;

export type HasPasskeyQuery = { userId: string };
export type PasskeyStatusView = { hasPasskey: boolean };

/**
 * アイコン画像のファイル (配信に使う). キーの形が違うか, 画像がなければ NotFoundError
 *
 * キーはランダムで, 差し替えると別のキーになるので, 応答はずっとキャッシュしてよい
 */
type GetAvatarFile = (
  q: GetAvatarFileQuery,
) => ResultAsync<AvatarFileView, AppError>;

export type GetAvatarFileQuery = {
  // URL のパス (/files/avatars/:key) のまま
  key: unknown;
};
export type AvatarFileView = {
  body: ReadableStream;
  // わからなければ null
  contentType: string | null;
  etag: string;
};

// ----------------------------------------------------------------------------
// メンバー集約 ユースケース
// ----------------------------------------------------------------------------
export interface MemberUsecase {
  // Commands: 招待
  issueInvite: IssueInvite;
  revokeInvite: RevokeInvite;
  startInvite: StartInvite;
  claimInvite: ClaimInvite;
  linkInvitedUser: LinkInvitedUser;

  // Commands: プロフィール・ログイン
  validateProfileUpdate: ValidateProfileUpdate;
  validateSignUp: ValidateSignUp;
  changeAvatar: ChangeAvatar;
  removeAvatar: RemoveAvatar;
  cleanupDeletedUser: CleanupDeletedUser;
  checkPasskeyDeletion: CheckPasskeyDeletion;

  // Queries
  listInvites: ListInvites;
  getDisplayUser: GetDisplayUser;
  hasPasskey: HasPasskey;
  getAvatarFile: GetAvatarFile;
}

// ----------------------------------------------------------------------------
// DTO
// ----------------------------------------------------------------------------
/**
 * InviteDto
 *
 * 日時は SQLite の "YYYY-MM-DD HH:MM:SS" (UTC) のまま渡す (画面側でパースしている)
 */
export type InviteDto = {
  id: number;
  createdAt: string;
  // 空なら無期限
  expiresAt: string | null;
  // 空なら未使用
  usedAt: string | null;
  // 使ったユーザーの名前. 未使用やユーザー削除済みなら空
  usedByName: string | null;
};

export type DisplayUserDto = {
  name: string;
  // #rrggbb. 未設定ならユーザー ID から決まる色
  color: string;
  // このアプリで保存したアイコンのパスか, http(s) の URL. なければ null
  image: string | null;
};
