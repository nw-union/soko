import { describe, expect, test } from "bun:test";
import type { Logger } from "@nw-union/nw-utils";
import { errAsync, okAsync } from "../../lib/rslt-test.ts";
import { newDatabaseError } from "../../domain/shared/error.ts";
import type { RateLimitPort } from "../../domain/shared/port.ts";
import {
  formatRetryAfter,
  MCP_LIMITS,
  newRateLimiter,
  purgeBefore,
} from "./rate-limit.ts";

// 2026-11-18T00:00:30Z（窓 60 秒の始まりから 30 秒）
const NOW = new Date(Date.UTC(2026, 10, 18, 0, 0, 30));
const clock = { now: () => NOW };

const newFakes = (fail = false) => {
  const counts = new Map<string, { windowStart: number; count: number }>();
  const errors: string[] = [];
  const port: RateLimitPort = {
    hit: (key, windowStart) => {
      if (fail) return errAsync(newDatabaseError("upsert failed"));
      const cur = counts.get(key);
      const count = cur && cur.windowStart === windowStart ? cur.count + 1 : 1;
      counts.set(key, { windowStart, count });
      return okAsync(count);
    },
    purge: () => okAsync(undefined),
  };
  const log = {
    error: (m: string) => errors.push(m),
  } as unknown as Logger;
  return { check: newRateLimiter(port, clock, log), counts, errors };
};

describe("newRateLimiter", () => {
  test("上限までは許し, 超えたら次の窓までの秒数を返す", async () => {
    const { check } = newFakes();
    const limit = { name: "t", max: 2, windowSeconds: 60 };
    expect(await check(limit, "u1")).toEqual({ allowed: true });
    expect(await check(limit, "u1")).toEqual({ allowed: true });
    expect(await check(limit, "u1")).toEqual({
      allowed: false,
      retryAfter: 30,
    });
  });

  test("相手ごとに別に数える", async () => {
    const { check } = newFakes();
    const limit = { name: "t", max: 1, windowSeconds: 60 };
    await check(limit, "u1");
    expect(await check(limit, "u2")).toEqual({ allowed: true });
  });

  test("相手を省くと全員で数え, key は名前だけ", async () => {
    const { check, counts } = newFakes();
    await check(MCP_LIMITS.sync);
    expect(await check(MCP_LIMITS.sync)).toMatchObject({ allowed: false });
    expect([...counts.keys()]).toEqual(["mcp:sync"]);
  });

  test("窓の始まりは, 窓の長さで切り下げた時刻", async () => {
    const { check, counts } = newFakes();
    await check(MCP_LIMITS.sync);
    const start = Math.floor(NOW.getTime() / 1000);
    expect(counts.get("mcp:sync")?.windowStart).toBe(start - (start % 600));
  });

  test("数えられなかったら, 止めずに通してログに残す", async () => {
    const { check, errors } = newFakes(true);
    expect(await check(MCP_LIMITS.user, "u1")).toEqual({ allowed: true });
    expect(errors).toHaveLength(1);
  });
});

describe("purgeBefore", () => {
  test("いちばん長い窓（1 時間）より前", () => {
    expect(purgeBefore(NOW)).toBe(Math.floor(NOW.getTime() / 1000) - 3600);
  });
});

describe("formatRetryAfter", () => {
  test.each([
    [30, "30 秒"],
    [60, "1 分"],
    [61, "2 分"],
    [600, "10 分"],
  ])("%d → %s", (s, expected) => {
    expect(formatRetryAfter(s)).toBe(expected);
  });
});
