// コンテキストをまたいで使うポート。失敗しないものなので Result では包まない

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
 *
 * 暗号論的に安全な乱数を返すこと (招待トークンの生成に使う)
 */
export interface RandomPort {
  bytes(length: number): Uint8Array;
}
