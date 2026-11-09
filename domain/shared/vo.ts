// Value Object。複数のコンテキストで使うものだけをここに置く（1 つのコンテキストでしか使わないものは、そのコンテキストの vo.ts に置く）。
//
// domain/ の中の相対 import は、必ず拡張子（.ts）を付けること。
// auth.ts は Void の CLI からも読み込まれ、そこでは拡張子なしの相対 import を解決できない。
// domain/ は auth.ts から import されるので、その先もすべて拡張子付きにする必要がある
import { err, ok, type Result } from "neverthrow";
import { match } from "ts-pattern";
import * as v from "valibot";
import { isYoutubeId } from "../rule/youtube.ts";
import { newValidationError, type ValidationError } from "./error.ts";

/**
 * newVo は, Value Object を生成する関数を作るためのヘルパー関数
 *
 * @param schema valibot のスキーマ (`v.brand()` を付けたもの)
 * @param type VO の型名. エラーのフィールド名の既定値になる
 *
 * @example
 * ```typescript
 * const youtubeId = v.pipe(v.string(), v.regex(/^[\w-]{11}$/), v.brand("YoutubeId"));
 * export type YoutubeId = v.InferOutput<typeof youtubeId>;
 * export const newYoutubeId = newVo(youtubeId, "YoutubeId");
 *
 * newYoutubeId(str); // VO の生成
 * newYoutubeId(str, "videoId"); // エラーのフィールド名を videoId にする場合
 * ```
 */
export const newVo =
  <T extends v.GenericSchema>(schema: T, type: string) =>
  (src: unknown, name?: string): Result<v.InferOutput<T>, ValidationError> =>
    match(v.safeParse(schema, src))
      .with({ success: true }, ({ output }) => ok(output))
      .with({ success: false }, ({ issues }) =>
        err(newValidationError(name || type, issues)),
      )
      .exhaustive();

/**
 * newVoOrNone は, Value Object を生成する関数を作るためのヘルパー関数
 *
 * 入力が null / undefined / 空文字のときは null. それ以外は `newVo` と同じ
 *
 * @param schema valibot のスキーマ (`v.brand()` を付けたもの)
 * @param type VO の型名
 */
export const newVoOrNone =
  <T extends v.GenericSchema>(schema: T, type: string) =>
  (
    src: unknown,
    name?: string,
  ): Result<v.InferOutput<T> | null, ValidationError> =>
    src === null || src === undefined || src === ""
      ? ok(null)
      : newVo(schema, type)(src, name);

// ----------------------------------------------------------------------------

/**
 * UserId ユーザーの ID (better-auth の user.id)
 *
 * 形式は better-auth が決めるので, 空でない文字列であることだけを確かめる
 */
const userId = v.pipe(v.string(), v.minLength(1), v.brand("UserId"));
export type UserId = v.InferOutput<typeof userId>;
export const newUserId = newVo(userId, "UserId");

/**
 * YoutubeId YouTube の動画 ID (watch?v= の後ろの 11 文字)
 *
 * href / src に埋め込むので, 必ずこの検証を通してから使う
 */
const youtubeId = v.pipe(
  v.string(),
  v.check(isYoutubeId),
  v.brand("YoutubeId"),
);
export type YoutubeId = v.InferOutput<typeof youtubeId>;
export const newYoutubeId = newVo(youtubeId, "YoutubeId");
