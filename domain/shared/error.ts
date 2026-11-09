/**
 * アプリケーションエラー
 *
 * 判別可能な union として定義し, `match(e).with({ type: ... }).exhaustive()` で
 * 網羅的に分岐できるようにする.
 */
export type AppError =
  | ValidationError
  | NotFoundError
  | ForbiddenError
  | ConflictError
  | DatabaseError
  | StorageError
  | ExternalError;

/**
 * バリデーションエラー
 *
 * issues はフィールド名をキーにしたエラー内容
 */
export interface ValidationError {
  readonly type: "ValidationError";
  readonly message: string;
  readonly issues: Readonly<Record<string, readonly string[]>>;
}

/**
 * データが見つからなかった時のエラー
 */
export interface NotFoundError {
  readonly type: "NotFoundError";
  readonly message: string;
}

/**
 * 権限が足りない時のエラー (ログインし直したばかりのセッションが必要な操作, など)
 *
 * code は画面が分岐に使う識別子 (例: SESSION_NOT_FRESH)
 */
export interface ForbiddenError {
  readonly type: "ForbiddenError";
  readonly message: string;
  readonly code?: string;
}

/**
 * 今の状態では受け付けられない時のエラー (招待の発行上限に達している, など)
 *
 * message はそのまま画面に出してよい文言にする
 */
export interface ConflictError {
  readonly type: "ConflictError";
  readonly message: string;
}

/**
 * データベース関連の致命的なエラー
 */
export interface DatabaseError {
  readonly type: "DatabaseError";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * ストレージ (R2) 関連の致命的なエラー
 */
export interface StorageError {
  readonly type: "StorageError";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * 外部のサービス (YouTube Data API など) 関連のエラー
 */
export interface ExternalError {
  readonly type: "ExternalError";
  readonly message: string;
  readonly cause?: unknown;
}

// ----------------------------------------------------------------------------
// Constructor
// ----------------------------------------------------------------------------
/**
 * スキーマの検証 (valibot の safeParse など) の結果の issues から作る
 */
export const newValidationError = (
  name: string,
  issues: readonly { readonly message: string }[],
): ValidationError => ({
  type: "ValidationError",
  message: `${name} is invalid`,
  issues: { [name]: issues.map((issue) => issue.message) },
});

export const newValidationErrorWithMessage = (
  name: string,
  message: string,
): ValidationError => ({
  type: "ValidationError",
  message: `${name} is invalid`,
  issues: { [name]: [message] },
});

export const mergeValidationError = (
  es: ValidationError[],
): ValidationError => ({
  type: "ValidationError",
  message: es.map((e) => e.message).join(", "),
  // 同じフィールドのエラーは連結する
  issues: Object.fromEntries(
    [...new Set(es.flatMap((e) => Object.keys(e.issues)))].map((k) => [
      k,
      es.flatMap((e) => e.issues[k] ?? []),
    ]),
  ),
});

export const newNotFoundError = (message: string): NotFoundError => ({
  type: "NotFoundError",
  message,
});

export const newForbiddenError = (
  message: string,
  code?: string,
): ForbiddenError => ({ type: "ForbiddenError", message, code });

export const newConflictError = (message: string): ConflictError => ({
  type: "ConflictError",
  message,
});

export const newDatabaseError = (
  message: string,
  cause?: unknown,
): DatabaseError => ({ type: "DatabaseError", message, cause });

export const newStorageError = (
  message: string,
  cause?: unknown,
): StorageError => ({ type: "StorageError", message, cause });

export const newExternalError = (
  message: string,
  cause?: unknown,
): ExternalError => ({ type: "ExternalError", message, cause });
