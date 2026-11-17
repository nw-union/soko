import { sequence, stepAsync, throughAsync } from "@nw-union/nw-utils/lib/rslt";
import type { ClockPort, RandomPort } from "../../shared/port.ts";
import { newUserId } from "../../shared/vo.ts";
import type { MemberUsecase } from "../api.ts";
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
import { createInviteToken, createTokenHash, TOKEN_LENGTH } from "./vo.ts";

/**
 * 招待のユースケースのうち, コマンド. 登録の手前のチェック (startInvite) もここに置く
 */
export const newInviteWorkFlows = (
  r: InviteRepositoryPort,
  clock: ClockPort,
  random: RandomPort,
): Pick<
  MemberUsecase,
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
    return stepAsync(
      // Step 1. バリデーション: string -> UserId
      newUserId(userId),
      // Step 2. 招待の作成: UserId -> NewInvite
      async (inviter) =>
        createNewInvite(token, await createTokenHash(token), inviter, now),
      // Step 3. 上限未満なら DB 保存: NewInvite -> boolean
      (invite) => r.insertInviteIfUnderLimit(invite, DEFAULT_INVITE_LIMIT, now),
      // Step 4. 上限の確認: boolean -> void
      ensureIssued,
      // Step 5. イベント発行
      () => ({ token: formatToken(token), days: INVITE_DAYS }),
    );
  },

  /**
   * 未使用の招待を取り消す
   */
  revokeInvite: ({ userId, id }) =>
    stepAsync(
      // Step 1. バリデーション: [string, unknown] -> [UserId, InviteId]
      sequence([newUserId(userId), validateInviteId(id)]),
      // Step 2. DB 削除
      ([inviter, i]) => r.deleteUnusedInvite(i, inviter),
    ),

  /**
   * 登録の入口. 招待トークンが今使えるか確かめる
   */
  startInvite: ({ token }) =>
    stepAsync(
      // Step 1. バリデーション: unknown -> InviteToken
      validateToken(token),
      // Step 2. 使えるか確認: InviteToken -> InviteToken
      throughAsync(async (t) =>
        stepAsync(
          r.isUsableInvite(await createTokenHash(t), clock.now()),
          ensureUsable,
        ),
      ),
      // Step 3. イベント発行
      (t) => ({ token: t }),
    ),

  /**
   * 招待を使用済みにする
   */
  claimInvite: ({ token }) =>
    stepAsync(
      // Step 1. バリデーション: unknown -> InviteToken
      validateToken(token),
      // Step 2. ハッシュ化: InviteToken -> TokenHash (WebCrypto は失敗しないので, 例外は想定しない)
      createTokenHash,
      // Step 3. 使用済みにする: TokenHash -> boolean
      (h) => r.claimInvite(h, clock.now()),
      // Step 4. 使えたか確認: boolean -> void
      ensureUsable,
    ),

  /**
   * 使用済みにした招待へ, 作られたユーザーを結び付ける
   */
  linkInvitedUser: ({ token, userId }) =>
    stepAsync(
      // Step 1. バリデーション: [unknown, string] -> [TokenHash, UserId]
      sequence([validateToken(token), newUserId(userId)]),
      async ([t, u]) => [await createTokenHash(t), u] as const,
      // Step 2. DB 保存
      ([h, u]) => r.setInvitedUser(h, u),
    ),
});
