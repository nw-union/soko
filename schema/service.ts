// アプリケーションサービスの I/F。Web 層（pages/ routes/ crons/ auth.ts）は、ここに定義した WorkFlows だけを呼ぶ。
// 入力（Cmd）は画面や API から来た値のまま受け取り、検証はドメインで行う
import type { ResultAsync } from "neverthrow";
import type { AppError } from "../error.ts";

// ============================================================================
// Invite
// ============================================================================

export interface InviteWorkFlows {
  /**
   * 自分が発行した招待の一覧と, あと何回発行できるか
   */
  listInvites(cmd: ListInvitesCmd): ResultAsync<ListInvitesEvt, AppError>;

  /**
   * 招待を発行する. 上限に達していれば ConflictError
   *
   * トークンはここで 1 回だけ返す (DB にはハッシュしか残らない)
   */
  issueInvite(cmd: IssueInviteCmd): ResultAsync<IssueInviteEvt, AppError>;

  /**
   * 未使用の招待を取り消す (枠が戻る). 使用済み・他人の招待・存在しない ID は何もしない
   */
  revokeInvite(cmd: RevokeInviteCmd): ResultAsync<void, AppError>;

  /**
   * 登録の入口. 招待トークンが今使えるか確かめ, 正規化したトークンを返す (Web 層が Cookie に入れる)
   *
   * 使えない理由は教えない (形式違い・存在しない・使用済み・期限切れは, すべて同じ ValidationError)
   */
  startInvite(cmd: StartInviteCmd): ResultAsync<StartInviteEvt, AppError>;

  /**
   * 登録 (ユーザー作成) の直前に, 招待を使用済みにする
   *
   * 同じトークンで同時に登録されても, 成功するのは 1 回だけ. 失敗の理由は startInvite と同じく教えない
   */
  claimInvite(cmd: ClaimInviteCmd): ResultAsync<void, AppError>;

  /**
   * 登録 (ユーザー作成) の直後に, 使用済みにした招待へ, 作られたユーザーを結び付ける
   */
  linkInvitedUser(cmd: LinkInvitedUserCmd): ResultAsync<void, AppError>;
}

export type ListInvitesCmd = { userId: string };
export type ListInvitesEvt = {
  limit: number;
  remaining: number;
  invites: InviteDto[];
};

export type IssueInviteCmd = { userId: string };
export type IssueInviteEvt = {
  // 画面に出す形 (XXXX-XXXX-XXXX-XXXX)
  token: string;
  // 有効日数
  days: number;
};

export type RevokeInviteCmd = {
  userId: string;
  // クエリ文字列のまま
  id: unknown;
};

export type StartInviteCmd = { token: unknown };
export type StartInviteEvt = {
  // 正規化したトークン (大文字・ハイフンなし)
  token: string;
};

export type ClaimInviteCmd = { token: unknown };
export type LinkInvitedUserCmd = { token: unknown; userId: string };

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
