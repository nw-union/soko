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
 */
export interface RandomPort {
  // 暗号論的に安全な乱数 (招待トークン・アイコン画像のキーの生成に使う)
  bytes(length: number): Uint8Array;
  // 0 以上 1 未満の乱数 (並べ替えに使う. 暗号論的に安全でなくてよい)
  float(): number;
}
