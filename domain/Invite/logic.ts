import { err, ok, type Result } from "neverthrow";
import {
  type ConflictError,
  newConflictError,
  newValidationErrorWithMessage,
  type ValidationError,
} from "../../error.ts";
import type { UserId } from "../vo.ts";
import type { InviteUsage, NewInvite } from "./type.ts";
import {
  type InviteId,
  type InviteToken,
  newInviteId,
  newInviteToken,
  type TokenHash,
} from "./vo.ts";

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
// Domain Logic (Domain Type -> Domain Type)
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
// Validater (DTO -> Domain Type)
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
// Converter (Domain Type -> DTO)
// ----------------------------------------------------------------------------
/**
 * 画面に出す形にする (XXXX-XXXX-XXXX-XXXX)
 */
export const formatToken = (token: InviteToken): string =>
  token.match(/.{1,4}/g)?.join("-") ?? "";
