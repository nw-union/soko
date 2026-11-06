// AppError を API の応答にする。本文は { message }（画面はこの message をそのまま出す）
import type { Context } from "hono";
import { match } from "ts-pattern";
import type { AppError, ValidationError } from "../error.ts";

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
    .with({ type: "ConflictError" }, (e) => c.json({ message: e.message }, 409))
    .with({ type: "DatabaseError" }, { type: "StorageError" }, (e) => {
      // 内部のエラーの内容は画面に出さず、ログにだけ残す
      console.error(`${e.type}: ${e.message}`, e.cause);
      return c.json({ message: INTERNAL_MESSAGE }, 500);
    })
    .exhaustive();
