// ワークフロー: 招待 (IssueInvite 招待を発行する・RevokeInvite 招待を取り消す・StartInvite 登録を始める・
// ClaimInvite 招待を使う・LinkInvitedUser 招待にユーザーを結び付ける・招待の一覧)
import { err, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import {
  type ConflictError,
  newConflictError,
  newValidationErrorWithMessage,
  type ValidationError,
} from "../../shared/error.ts";
import type { ClockPort, RandomPort } from "../../shared/port.ts";
import { newUserId, type UserId } from "../../shared/vo.ts";
import type { MemberUsecase } from "../api.ts";
import { convToInviteDto, formatToken } from "../converter.ts";
import type { InviteRepositoryPort } from "../port.ts";
import type { InviteUsage, NewInvite } from "../type.ts";
import {
  createInviteToken,
  createTokenHash,
  type InviteId,
  type InviteToken,
  newInviteId,
  newInviteToken,
  TOKEN_LENGTH,
  type TokenHash,
} from "../vo.ts";

/**
 * 1 人が発行できる招待の数の初期値. 実際の上限はユーザーごとに user.inviteLimit に持つ (auth.ts の defaultValue もこれを使う)
 */
export const DEFAULT_INVITE_LIMIT = 3;

/**
 * 招待の有効日数
 */
export const INVITE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------
// Step: バリデーション (Cmd → ドメインの型)
// ----------------------------------------------------------------------------
/**
 * 使えない招待のエラー. 理由 (形式違い・存在しない・使用済み・期限切れ) は教えない
 */
export const invalidInvite = (): ValidationError =>
  newValidationErrorWithMessage(
    "token",
    "招待コードが正しくないか、期限切れです",
  );

/**
 * 入力されたトークンを正規化する
 *
 * 大文字小文字・ハイフン・空白の違いは無視する (スマホで打ち間違えにくいように)
 */
export const normalizeToken = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * 入力されたトークンを検証する. 失敗の理由は教えない
 */
export const validateToken = (
  raw: unknown,
): Result<InviteToken, ValidationError> =>
  newInviteToken(
    normalizeToken(typeof raw === "string" ? raw : ""),
    "token",
  ).mapErr(invalidInvite);

/**
 * 取り消す招待の ID を検証する
 */
export const validateInviteId = (
  raw: unknown,
): Result<InviteId, ValidationError> =>
  newInviteId(raw, "id").mapErr(() =>
    newValidationErrorWithMessage("id", "id が正しくありません"),
  );

// ----------------------------------------------------------------------------
// Step: 招待の作成と上限の確認
// ----------------------------------------------------------------------------
/**
 * 発行する招待を作る. 期限は発行から INVITE_DAYS 日
 */
export const createNewInvite = (
  token: InviteToken,
  tokenHash: TokenHash,
  inviterUserId: UserId,
  now: Date,
): NewInvite => ({
  type: "NewInvite",
  token,
  tokenHash,
  inviterUserId,
  expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS),
});

/**
 * 発行できる招待の上限 (user.inviteLimit がなければ初期値)
 */
export const limitOf = (usage: InviteUsage): number =>
  usage.limit ?? DEFAULT_INVITE_LIMIT;

/**
 * あと何回発行できるか
 */
export const remainingOf = (usage: InviteUsage): number =>
  Math.max(0, limitOf(usage) - usage.used);

/**
 * 招待を保存できたか (上限未満だったか) を確かめる
 */
export const ensureIssued = (inserted: boolean): Result<void, ConflictError> =>
  inserted
    ? ok(undefined)
    : err(newConflictError("招待の発行上限に達しています"));

/**
 * 招待が使えたか (未使用で期限内だったか) を確かめる
 */
export const ensureUsable = (usable: boolean): Result<void, ValidationError> =>
  usable ? ok(undefined) : err(invalidInvite());

// ----------------------------------------------------------------------------
// 実装
// ----------------------------------------------------------------------------
/**
 * トークンをハッシュ化する (WebCrypto は失敗しないので, 例外は想定しない)
 */
const hash = (token: InviteToken) =>
  ResultAsync.fromSafePromise(createTokenHash(token));

/**
 * 招待. 登録の手前のチェック (startInvite) もここに置く
 */
export const newInviteWorkflow = (
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
  | "listInvites"
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

  /**
   * 自分が発行した招待の一覧と, あと何回発行できるか
   */
  listInvites: ({ userId }) =>
    okAsync(userId)
      // Step 1. バリデーション: string -> UserId
      .andThen((id) => newUserId(id))
      // Step 2. 一覧と利用状況の取得: UserId -> [IssuedInvite[], InviteUsage]
      .andThen((inviter) =>
        ResultAsync.combine([
          r.listInvites(inviter),
          r.readUsage(inviter, clock.now()),
        ]),
      )
      // Step 3. View に組み立てる
      .map(([invites, usage]) => ({
        limit: limitOf(usage),
        remaining: remainingOf(usage),
        invites: invites.map(convToInviteDto),
      })),
});
