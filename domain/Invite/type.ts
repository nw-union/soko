import type { UserId } from "../vo.ts";
import type { InviteToken, TokenHash } from "./vo.ts";

/**
 * 発行する招待 (まだ保存していない)
 *
 * token は発行した本人に見せるためだけに持つ. 保存するのは tokenHash だけ
 */
export interface NewInvite {
  readonly type: "NewInvite";
  readonly token: InviteToken;
  readonly tokenHash: TokenHash;
  readonly inviterUserId: UserId;
  readonly expiresAt: Date;
}

/**
 * 招待の利用状況 (発行上限の判断に使う)
 */
export interface InviteUsage {
  readonly type: "InviteUsage";
  // user.inviteLimit. 値がなければ null (初期値を使う)
  readonly limit: number | null;
  // 数える招待の数 (InviteRepositoryPort の「数える招待」を参照)
  readonly used: number;
}
