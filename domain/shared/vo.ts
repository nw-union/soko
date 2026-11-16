// Value Object。複数のコンテキストで使うものだけをここに置く（1 つのコンテキストでしか使わないものは、そのコンテキストの vo.ts に置く）。
//
// domain/ の中の相対 import は、必ず拡張子（.ts）を付けること。
// auth.ts は Void の CLI からも読み込まれ、そこでは拡張子なしの相対 import を解決できない。
// domain/ は auth.ts から import されるので、その先もすべて拡張子付きにする必要がある

import { match } from "@nw-union/nw-utils/lib/match";
import { err, ok, type Result } from "@nw-union/nw-utils/lib/rslt";
import {
  type InferVo,
  type Issue,
  type Parser,
  type Schema,
  type Vo,
  v,
} from "@nw-union/nw-utils/lib/vo";
import { isYoutubeId } from "../rule/youtube.ts";
import { newValidationError, type ValidationError } from "./error.ts";

/**
 * newVo は, Value Object を生成する関数を作るためのヘルパー関数
 *
 * `@nw-union/nw-utils/lib/vo` の `newVo` は nw-utils の ValidationError を返すので使わず,
 * パーサー (`v.*`) と型だけを借りて, ドメインの ValidationError を返す
 *
 * @param type VO の型名. brand 名と, エラーのフィールド名の既定値になる
 * @param schema パーサー (`v.string` などの型チェックで始まるもの)
 *
 * @example
 * ```typescript
 * export const newYoutubeId = newVo("YoutubeId", v.chain(v.string, v.regex(/^[\w-]{11}$/)));
 * export type YoutubeId = InferVo<typeof newYoutubeId>;
 *
 * newYoutubeId(str); // VO の生成
 * newYoutubeId(str, "videoId"); // エラーのフィールド名を videoId にする場合
 * ```
 */
export const newVo =
  <B extends string, O>(type: B, schema: Schema<O>) =>
  (src: unknown, name?: string): Result<Vo<O, B>, ValidationError> =>
    match(schema(src))
      .ok((output) => ok(output as Vo<O, B>))
      .err((issue) => err(newValidationError(name || type, [issue])))
      .exhaustive();

/**
 * newVoOrNone は, Value Object を生成する関数を作るためのヘルパー関数
 *
 * 入力が null / undefined / 空文字のときは null. それ以外は `newVo` と同じ
 *
 * @param type VO の型名
 * @param schema パーサー
 */
export const newVoOrNone =
  <B extends string, O>(type: B, schema: Schema<O>) =>
  (src: unknown, name?: string): Result<Vo<O, B> | null, ValidationError> =>
    src === null || src === undefined || src === ""
      ? ok(null)
      : newVo(type, schema)(src, name);

/**
 * 内部で作った値を VO にする. 検証に通らなければ例外 (プログラムの誤り)
 */
export const mustVo = <T>(r: Result<T, ValidationError>): T =>
  match(r)
    .ok((value) => value)
    .err((e) => {
      throw new Error(e.message);
    })
    .exhaustive();

// ----------------------------------------------------------------------------
// lib/vo にないパーサー
// ----------------------------------------------------------------------------
const fail = (message: string) => err<Issue>({ message });

// エラーメッセージ用に値を文字列にする (文字列は引用符で囲む. valibot と同じ)
const show = (input: unknown) =>
  typeof input === "string" ? JSON.stringify(input) : String(input);

/**
 * 関数で判定する (valibot の v.check と同じ)
 */
export const check =
  <T>(cond: (input: T) => boolean): Parser<T, T> =>
  (input) =>
    cond(input) ? ok(input) : fail(`Invalid input: Received ${show(input)}`);

/**
 * 前後の空白を除く (valibot の v.trim と同じ)
 */
export const trim: Parser<string, string> = (input) => ok(input.trim());

/**
 * 安全な整数 (valibot の v.safeInteger と同じ)
 */
export const safeInteger: Parser<number, number> = check<number>(
  Number.isSafeInteger,
);

/**
 * 何でも Number() で数値にする (valibot の v.transform(Number) と同じ). 後ろに v.number を置いて NaN を弾く
 */
export const toNumber: Parser<unknown, number> = (input) => ok(Number(input));

// ----------------------------------------------------------------------------

/**
 * UserId ユーザーの ID (better-auth の user.id)
 *
 * 形式は better-auth が決めるので, 空でない文字列であることだけを確かめる
 */
export const newUserId = newVo("UserId", v.chain(v.string, v.minLength(1)));
export type UserId = InferVo<typeof newUserId>;

/**
 * YoutubeId YouTube の動画 ID (watch?v= の後ろの 11 文字)
 *
 * href / src に埋め込むので, 必ずこの検証を通してから使う
 */
export const newYoutubeId = newVo(
  "YoutubeId",
  v.chain(v.string, check(isYoutubeId)),
);
export type YoutubeId = InferVo<typeof newYoutubeId>;
