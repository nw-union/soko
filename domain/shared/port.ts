// コンテキストをまたいで使うポート。時計と乱数は失敗しないものなので Result では包まない
import type { ResultAsync } from "@nw-union/nw-utils/lib/rslt";
import type { AppError } from "./error.ts";

/**
 * 時計ポート
 *
 * 現在日時をテストで固定できるように、ドメインでは Date.now() / new Date() を直接使わない
 */
export interface ClockPort {
  now(): Date;
}

/**
 * 乱数ポート
 */
export interface RandomPort {
  // 暗号論的に安全な乱数 (招待トークン・アイコン画像のキーの生成に使う)
  bytes(length: number): Uint8Array;
  // 0 以上 1 未満の乱数 (並べ替えに使う. 暗号論的に安全でなくてよい)
  float(): number;
}

/**
 * レート制限の回数のポート (固定の時間窓)
 *
 * hit は「窓が同じなら 1 増やし, 変わっていたら 1 にする」と「増やした後の回数を返す」を 1 つの操作で行うこと
 * (読んでから書くと, 同時に呼ばれたときに数え漏れる)
 */
export interface RateLimitPort {
  // key の回数を数え, 数えた後の回数を返す. windowStart は窓の始まり (Unix 時間の秒)
  hit(key: string, windowStart: number): ResultAsync<number, AppError>;
  // 窓の始まりが before (Unix 時間の秒) より前の行を消す
  purge(before: number): ResultAsync<void, AppError>;
}
