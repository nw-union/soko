// MCP のレート制限（docs/design/mcp.md の 9 章 C7）。回数は D1 の rate_limits に固定の時間窓で数える。
// 数えられなかったとき（DB のエラー）は、止めずに通してログに残す（レート制限のせいで使えなくなるより、通す方をとる）
import type { Logger } from "@nw-union/nw-utils";
import { match } from "@nw-union/nw-utils/lib/match";
import type { ClockPort, RateLimitPort } from "../../domain/shared/port.ts";
import { logAppError } from "../log/logger.ts";

export type RateLimit = {
  // key の前半（何を数えるか）
  name: string;
  // 窓の中で許す回数
  max: number;
  // 窓の長さ（秒）
  windowSeconds: number;
};

export const MCP_LIMITS = {
  // 1 人あたりの MCP のリクエスト（ツールの一覧・呼び出しなど）
  user: { name: "mcp:user", max: 60, windowSeconds: 60 },
  // 新着の取り込み（全員で）。YouTube の割り当てを守る。定期の取り込みは cron が別に行う
  sync: { name: "mcp:sync", max: 1, windowSeconds: 10 * 60 },
  // 1 人あたりのプレイリストの追加
  addPlaylist: { name: "mcp:add-playlist", max: 10, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimit>;

export type RateLimitResult =
  | { allowed: true }
  // retryAfter: 次の窓までの秒数
  | { allowed: false; retryAfter: number };

/** 1 回数えて、許すか決める */
export type CheckRateLimit = (
  limit: RateLimit,
  // 誰の回数か（ユーザー ID など）。全員で数えるものは省く
  subject?: string,
) => Promise<RateLimitResult>;

export const newRateLimiter =
  (port: RateLimitPort, clock: ClockPort, log: Logger): CheckRateLimit =>
  async (limit, subject) => {
    const now = Math.floor(clock.now().getTime() / 1000);
    const windowStart = now - (now % limit.windowSeconds);
    const key = subject ? `${limit.name}:${subject}` : limit.name;
    return match(await port.hit(key, windowStart))
      .ok(
        (count): RateLimitResult =>
          count <= limit.max
            ? { allowed: true }
            : {
                allowed: false,
                retryAfter: windowStart + limit.windowSeconds - now,
              },
      )
      .err((e): RateLimitResult => {
        logAppError(log, e);
        return { allowed: true };
      })
      .exhaustive();
  };

/** 古い回数の行を消す（全件の同期の cron から呼ぶ）。いちばん長い窓より前のものだけ */
export const purgeBefore = (now: Date) => {
  const longest = Math.max(
    ...Object.values(MCP_LIMITS).map((l) => l.windowSeconds),
  );
  return Math.floor(now.getTime() / 1000) - longest;
};

/** 待ってほしい時間を、人が読む言葉にする */
export const formatRetryAfter = (seconds: number) =>
  seconds >= 60 ? `${Math.ceil(seconds / 60)} 分` : `${seconds} 秒`;
