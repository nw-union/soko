import { stepAsync } from "@nw-union/nw-utils/lib/rslt";
import { sql } from "void/db";
import type { RateLimitPort } from "../../domain/shared/port.ts";
import { type Database, query } from "./util.ts";

export const newRateLimitRepository = (db: Database): RateLimitPort => ({
  // 1 文で数える（同時に呼ばれても数え漏れない）。窓が変わっていたら 1 から数え直す
  hit: (key, windowStart) =>
    stepAsync(
      query("hitRateLimit", () =>
        db.all<{ count: number }>(
          sql`INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
              ON CONFLICT(key) DO UPDATE SET
                count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
                window_start = excluded.window_start
              RETURNING count`,
        ),
      ),
      (rows) => rows[0]?.count ?? 1,
    ),

  purge: (before) =>
    stepAsync(
      query("purgeRateLimits", () =>
        db.run(sql`DELETE FROM rate_limits WHERE window_start < ${before}`),
      ),
      () => undefined,
    ),
});
