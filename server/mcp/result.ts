// AppError と成功値を、MCP のツールの結果（CallToolResult）にする。
// 考え方は server/http/error.ts と同じ: 入力の誤りなどは文言を返し、内部のエラーの中身はログにだけ残す
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "@nw-union/nw-utils";
import { match, P } from "@nw-union/nw-utils/lib/match";
import type { AppError } from "../../domain/shared/error.ts";
import { logAppError } from "../log/logger.ts";

export const INTERNAL_MESSAGE =
  "サーバーでエラーが発生しました。時間をおいて、もう一度お試しください";

/** 成功: 構造化した値と、同じ内容の JSON の文字列（structuredContent を読まないクライアント向け） */
export const toolOk = (value: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});

/** 失敗: LLM が読んで直せるように, 文言だけを返す */
export const toolError = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

export const toolAppError = (log: Logger, e: AppError): CallToolResult =>
  match(e)
    .with({ type: "ValidationError" }, (e) =>
      toolError(Object.values(e.issues)[0]?.[0] ?? e.message),
    )
    .with(
      P.union(
        { type: "NotFoundError" },
        { type: "ForbiddenError" },
        { type: "ConflictError" },
      ),
      (e) => toolError(e.message),
    )
    .with(
      P.union(
        { type: "DatabaseError" },
        { type: "StorageError" },
        { type: "ExternalError" },
      ),
      (e) => {
        logAppError(log, e);
        return toolError(INTERNAL_MESSAGE);
      },
    )
    .exhaustive();
