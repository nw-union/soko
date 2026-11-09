import { okAsync, ResultAsync } from "neverthrow";
import type { ClockPort, RandomPort } from "../../shared/port.ts";
import { newUserId } from "../../shared/vo.ts";
import type { MemberWorkFlows } from "../api.ts";
import {
  createNewInvite,
  DEFAULT_INVITE_LIMIT,
  ensureIssued,
  ensureUsable,
  formatToken,
  INVITE_DAYS,
  validateInviteId,
  validateToken,
} from "./logic.ts";
import type { InviteRepositoryPort } from "./port.ts";
import {
  createInviteToken,
  createTokenHash,
  type InviteToken,
  TOKEN_LENGTH,
} from "./vo.ts";

/**
 * 招待の WorkFlows (コマンド). 登録の手前のチェック (startInvite) もここに置く
 */
export const newInviteWorkFlows = (
  r: InviteRepositoryPort,
  clock: ClockPort,
  random: RandomPort,
): Pick<
  MemberWorkFlows,
  | "issueInvite"
  | "revokeInvite"
  | "startInvite"
  | "claimInvite"
  | "linkInvitedUser"
> => ({
  /**
   * 招待を発行する
   */
  issueInvite: ({ userId }) => {
    const now = clock.now();
    const token = createInviteToken(random.bytes(TOKEN_LENGTH));
    return (
      okAsync(userId)
        // Step 1. バリデーション: string -> UserId
        .andThen((id) => newUserId(id))
        // Step 2. 招待の作成: UserId -> NewInvite
        .andThen((inviter) =>
          hash(token).map((h) => createNewInvite(token, h, inviter, now)),
        )
        // Step 3. 上限未満なら DB 保存: NewInvite -> boolean
        .andThen((invite) =>
          r.insertInviteIfUnderLimit(invite, DEFAULT_INVITE_LIMIT, now),
        )
        // Step 4. 上限の確認: boolean -> void
        .andThen(ensureIssued)
        // Step 5. イベント発行
        .map(() => ({ token: formatToken(token), days: INVITE_DAYS }))
    );
  },

  /**
   * 未使用の招待を取り消す
   */
  revokeInvite: ({ userId, id }) =>
    // Step 1. バリデーション: [string, unknown] -> [UserId, InviteId]
    okAsync(undefined)
      .andThen(() => newUserId(userId))
      .andThen((inviter) =>
        validateInviteId(id).map((i) => [i, inviter] as const),
      )
      // Step 2. DB 削除
      .andThen(([i, inviter]) => r.deleteUnusedInvite(i, inviter)),

  /**
   * 登録の入口. 招待トークンが今使えるか確かめる
   */
  startInvite: ({ token }) =>
    okAsync(token)
      // Step 1. バリデーション: unknown -> InviteToken
      .andThen(validateToken)
      // Step 2. 使えるか確認: InviteToken -> InviteToken
      .andThrough((t) =>
        hash(t)
          .andThen((h) => r.isUsableInvite(h, clock.now()))
          .andThen(ensureUsable),
      )
      // Step 3. イベント発行
      .map((t) => ({ token: t })),

  /**
   * 招待を使用済みにする
   */
  claimInvite: ({ token }) =>
    okAsync(token)
      // Step 1. バリデーション: unknown -> InviteToken
      .andThen(validateToken)
      // Step 2. ハッシュ化: InviteToken -> TokenHash
      .andThen(hash)
      // Step 3. 使用済みにする: TokenHash -> boolean
      .andThen((h) => r.claimInvite(h, clock.now()))
      // Step 4. 使えたか確認: boolean -> void
      .andThen(ensureUsable),

  /**
   * 使用済みにした招待へ, 作られたユーザーを結び付ける
   */
  linkInvitedUser: ({ token, userId }) =>
    // Step 1. バリデーション: [unknown, string] -> [TokenHash, UserId]
    okAsync(token)
      .andThen(validateToken)
      .andThen(hash)
      .andThen((h) => newUserId(userId).map((u) => [h, u] as const))
      // Step 2. DB 保存
      .andThen(([h, u]) => r.setInvitedUser(h, u)),
});

/**
 * トークンをハッシュ化する (WebCrypto は失敗しないので, 例外は想定しない)
 */
const hash = (token: InviteToken) =>
  ResultAsync.fromSafePromise(createTokenHash(token));
