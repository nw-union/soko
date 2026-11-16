// ログ。@nw-union/nw-utils のロガー（Logger・newLogJson・newLogConsole）を使う。
// 環境変数は読まない（読むのは server/log/log.ts）。auth.ts から辿られるので、相対 import には .ts を付けること
import { type Logger, type LogLevel, SystemError } from "@nw-union/nw-utils";
import { newLogConsole } from "@nw-union/nw-utils/adapter/log-console";
import { newLogJson } from "@nw-union/nw-utils/adapter/log-json";
import type { AppError } from "../../domain/shared/error.ts";

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * ロガーを作る. 未設定や不正な値は json の info 以上
 */
export const newLogger = (adapter?: string, level?: string): Logger => {
  const lv = LEVELS.find((l) => l === level) ?? "info";
  return adapter === "console" ? newLogConsole(lv) : newLogJson(lv);
};

/**
 * 内部のエラー（DB・ストレージ・外部サービス）をログに残す. 画面には出さない.
 * nw-utils のロガーは nw-utils のエラーを受け取るので, システム起因の SystemError にして, 元の例外のスタックを付ける
 */
export const logAppError = (log: Logger, e: AppError) => {
  const cause = "cause" in e ? e.cause : undefined;
  log.error(
    `${e.type}: ${e.message}`,
    new SystemError(
      e.message,
      [e.type],
      cause === undefined
        ? undefined
        : cause instanceof Error
          ? cause
          : new Error(String(cause)),
    ),
  );
};
