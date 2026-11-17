// テストで Result を扱うための関数（`*.test.ts` からだけ使う）
import { match } from "@nw-union/nw-utils/lib/match";
import {
  err,
  ok,
  type Result,
  type ResultAsync,
} from "@nw-union/nw-utils/lib/rslt";

/**
 * 成功値を取り出す. 失敗なら例外にする (テストを落とす)
 */
export const unwrap = <T, E>(r: Result<T, E>): T =>
  match(r)
    .ok((value) => value)
    .err((error) => {
      throw new Error(`Success を期待したが Failure: ${JSON.stringify(error)}`);
    })
    .exhaustive();

/**
 * エラーを取り出す. 成功なら例外にする (テストを落とす)
 */
export const unwrapErr = <T, E>(r: Result<T, E>): E =>
  match(r)
    .ok((value) => {
      throw new Error(`Failure を期待したが Success: ${JSON.stringify(value)}`);
    })
    .err((error) => error)
    .exhaustive();

/**
 * 成功の ResultAsync を作る (fake の Port で使う)
 */
export function okAsync(): ResultAsync<void, never>;
export function okAsync<T>(value: T): ResultAsync<T, never>;
export function okAsync<T>(value?: T): ResultAsync<T | undefined, never> {
  return Promise.resolve(ok(value));
}

/**
 * 失敗の ResultAsync を作る (fake の Port で使う)
 */
export const errAsync = <E>(error: E): ResultAsync<never, E> =>
  Promise.resolve(err(error));
