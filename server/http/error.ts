// AppError を API の応答にする。本文は { message }（画面はこの message をそのまま出す）

import { match, P } from "@nw-union/nw-utils/lib/match";
import type { ResultAsync } from "@nw-union/nw-utils/lib/rslt";
import type { Context } from "hono";
import type { AppError, ValidationError } from "../../domain/shared/error.ts";
import { log } from "../log/log.ts";
import { logAppError } from "../log/logger.ts";

const INTERNAL_MESSAGE =
  "サーバーでエラーが発生しました。時間をおいて、もう一度お試しください";

// 画面に出すのは、最初の項目の最初のエラー
const firstIssue = (e: ValidationError) =>
  Object.values(e.issues)[0]?.[0] ?? e.message;

export const errorResponse = (c: Context, e: AppError) =>
  match(e)
    .with({ type: "ValidationError" }, (e) =>
      c.json({ message: firstIssue(e) }, 400),
    )
    .with({ type: "NotFoundError" }, (e) => c.json({ message: e.message }, 404))
    .with({ type: "ForbiddenError" }, (e) =>
      c.json({ message: e.message, code: e.code }, 403),
    )
    .with({ type: "ConflictError" }, (e) => c.json({ message: e.message }, 409))
    .with(P.union({ type: "DatabaseError" }, { type: "StorageError" }), (e) => {
      // 内部のエラーの内容は画面に出さず、ログにだけ残す
      logAppError(log(), e);
      return c.json({ message: INTERNAL_MESSAGE }, 500);
    })
    .with({ type: "ExternalError" }, (e) => {
      logAppError(log(), e);
      return c.json({ message: INTERNAL_MESSAGE }, 502);
    })
    .exhaustive();

/**
 * ページの loader で, エラーを例外にする (Void のエラー画面に任せる). 内部のエラーの内容はログにだけ残す
 */
export const throwError = (e: AppError): never => {
  if ("cause" in e) logAppError(log(), e);
  throw new Error(`${e.type}: ${e.message}`);
};

/**
 * API の応答にする. 成功なら onOk の戻り値, 失敗なら errorResponse
 */
export const respond = async <T, R>(
  c: Context,
  r: ResultAsync<T, AppError>,
  onOk: (value: T) => R,
) => {
  return match(await r)
    .ok(onOk)
    .err((e) => errorResponse(c, e))
    .exhaustive();
};

/**
 * 成功値を取り出す. 失敗なら throwError (ページの loader・cron・ミドルウェアで使う)
 */
export const valueOrThrow = async <T>(
  r: ResultAsync<T, AppError>,
): Promise<T> => {
  return match(await r)
    .ok((value) => value)
    .err(throwError)
    .exhaustive();
};
