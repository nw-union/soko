import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { newDatabaseError, newExternalError } from "../domain/shared/error.ts";
import { logAppError, newLogger } from "./logger.ts";

// console.log に出た行を集める
let lines: string[] = [];
let spy: ReturnType<typeof spyOn>;
beforeEach(() => {
  lines = [];
  spy = spyOn(console, "log").mockImplementation((s: unknown) => {
    lines.push(String(s));
  });
});
afterEach(() => spy.mockRestore());

describe("newLogger", () => {
  it("未設定なら, json の info 以上を出す", () => {
    // Arrange:
    const log = newLogger();

    // Act:
    log.debug("d");
    log.info("i");
    log.warn("w");

    // Assert:
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["info", "warn"]);
    expect(JSON.parse(lines[0])).toMatchObject({ message: "i" });
  });

  it("LOG_LEVEL に合わせて, それ未満は出さない", () => {
    // Act:
    const log = newLogger("json", "warn");
    log.info("i");
    log.warn("w");
    log.error("e");

    // Assert:
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["warn", "error"]);
  });

  it("不正なレベルは info にする", () => {
    // Act:
    newLogger("json", "verbose").info("i");

    // Assert:
    expect(lines).toHaveLength(1);
  });

  it("console なら, 色付きの読みやすい形で出す", () => {
    // Act:
    newLogger("console", "info").info("hello");

    // Assert:
    expect(lines[0]).toContain("hello");
    expect(() => JSON.parse(lines[0])).toThrow();
  });
});

describe("logAppError", () => {
  it("種類とメッセージを残し, 元の例外のスタックを付ける", () => {
    // Arrange:
    const cause = new Error("connection reset");

    // Act:
    logAppError(
      newLogger("json"),
      newDatabaseError("DB の操作に失敗しました", cause),
    );

    // Assert:
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      level: "error",
      message: "DatabaseError: DB の操作に失敗しました",
      error: { code: "System Error", details: ["DatabaseError"] },
    });
  });

  it("元の例外が Error でなくても, 文字列にして付ける (console では スタックに出る)", () => {
    // Act:
    logAppError(
      newLogger("console"),
      newExternalError("YouTube API に失敗しました", "403 Forbidden"),
    );

    // Assert:
    const text = lines.join("\n");
    expect(text).toContain("ExternalError: YouTube API に失敗しました");
    expect(text).toContain("Caused by: Error: 403 Forbidden");
  });

  it("元の例外がなくても, ログを出せる", () => {
    // Act:
    logAppError(newLogger("json"), newDatabaseError("x"));

    // Assert:
    expect(JSON.parse(lines[0]).level).toBe("error");
  });
});
