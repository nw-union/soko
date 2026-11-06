import { ResultAsync } from "neverthrow";
import type { db } from "void/db";
import { type DatabaseError, newDatabaseError } from "../../error.ts";

export type Database = typeof db;

/**
 * DB の操作を ResultAsync にする. 例外は DatabaseError にする
 */
export const query = <T>(
  label: string,
  run: () => Promise<T>,
): ResultAsync<T, DatabaseError> =>
  ResultAsync.fromPromise(run(), (e) =>
    newDatabaseError(`DB の操作に失敗しました: ${label}`, e),
  );

/**
 * Date を SQLite の datetime() と同じ形 ("YYYY-MM-DD HH:MM:SS", UTC) にする.
 * DB の日時の列はこの形の文字列で持っているので, 比較もこの形で行う
 */
export const toSqliteDatetime = (date: Date): string =>
  date.toISOString().slice(0, 19).replace("T", " ");
