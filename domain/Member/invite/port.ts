import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../../error.ts";
import type { InviteDto } from "../../../schema/service.ts";
import type { UserId } from "../../vo.ts";
import type { InviteUsage, NewInvite } from "./type.ts";
import type { InviteId, TokenHash } from "./vo.ts";

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
  listInvites(inviter: UserId): ResultAsync<InviteDto[], AppError>;

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
