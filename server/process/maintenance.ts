// 定期の後片付け. cron（crons/sync-videos.ts）から呼ぶ
import { match } from "@nw-union/nw-utils/lib/match";
import { container } from "../container.ts";
import { log } from "../log/log.ts";
import { logAppError } from "../log/logger.ts";
import { purgeBefore } from "../mcp/rate-limit.ts";

/** 使い終わったレート制限の回数を消す. 失敗してもログに残すだけ（次の回に消える） */
export const purgeRateLimits = async (): Promise<void> => {
  match(await container().rateLimit.purge(purgeBefore(new Date())))
    .ok(() => undefined)
    .err((e) => logAppError(log(), e))
    .exhaustive();
};
