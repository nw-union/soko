import { describe, expect, it } from "bun:test";
import { match } from "@nw-union/nw-utils/lib/match";
import { type Schema, v } from "@nw-union/nw-utils/lib/vo";
import {
  mergeValidationError,
  newValidationError,
  newValidationErrorWithMessage,
} from "./error.ts";

const issuesOf = <T>(schema: Schema<T>, src: unknown) =>
  match(schema(src))
    .ok(() => {
      throw new Error("schema must fail");
    })
    .err((issue) => [issue])
    .exhaustive();

describe("newValidationError", () => {
  it("フィールド名をキーにしたエラー内容を持つ", () => {
    // Arrange:
    const e = issuesOf(v.chain(v.string, v.minLength(1)), "");

    // Act:
    const actual = newValidationError("name", e);

    // Assert:
    expect(actual.type).toBe("ValidationError");
    expect(Object.keys(actual.issues)).toEqual(["name"]);
    expect(actual.issues.name.length).toBe(1);
  });
});

describe("newValidationErrorWithMessage", () => {
  it("指定した文言をそのままエラー内容にする", () => {
    // Act:
    const actual = newValidationErrorWithMessage("color", "形式が違います");

    // Assert:
    expect(actual.issues).toEqual({ color: ["形式が違います"] });
  });
});

describe("mergeValidationError", () => {
  it("複数のエラーのフィールドを 1 つにまとめる", () => {
    // Arrange:
    const e1 = newValidationError(
      "name",
      issuesOf(v.chain(v.string, v.minLength(1)), ""),
    );
    const e2 = newValidationError(
      "color",
      issuesOf(v.chain(v.string, v.minLength(1)), ""),
    );

    // Act:
    const actual = mergeValidationError([e1, e2]);

    // Assert:
    expect(actual.type).toBe("ValidationError");
    expect(Object.keys(actual.issues).sort()).toEqual(["color", "name"]);
  });

  it("同じフィールドのエラーは連結する", () => {
    // Arrange:
    const e1 = newValidationError(
      "name",
      issuesOf(v.chain(v.string, v.minLength(1)), ""),
    );
    const e2 = newValidationError(
      "name",
      issuesOf(v.chain(v.string, v.maxLength(0)), "a"),
    );

    // Act:
    const actual = mergeValidationError([e1, e2]);

    // Assert:
    expect(actual.issues.name.length).toBe(2);
  });
});
