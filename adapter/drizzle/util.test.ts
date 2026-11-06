import { describe, expect, it } from "bun:test";
import { toSqliteDatetime } from "./util.ts";

describe("toSqliteDatetime", () => {
  it("SQLite の datetime('now') と同じ形 (UTC, ミリ秒なし) にする", () => {
    // Act:
    const actual = toSqliteDatetime(new Date("2026-11-08T09:05:03.456Z"));

    // Assert:
    expect(actual).toBe("2026-11-08 09:05:03");
  });
});
