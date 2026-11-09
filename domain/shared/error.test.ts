import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import {
  mergeValidationError,
  newValidationError,
  newValidationErrorWithMessage,
} from "./error.ts";

const issuesOf = (schema: v.GenericSchema, src: unknown) => {
  const r = v.safeParse(schema, src);
  if (r.success) throw new Error("schema must fail");
  return r.issues;
};

describe("newValidationError", () => {
  it("フィールド名をキーにしたエラー内容を持つ", () => {
    // Arrange:
    const e = issuesOf(v.pipe(v.string(), v.minLength(1)), "");

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
      issuesOf(v.pipe(v.string(), v.minLength(1)), ""),
    );
    const e2 = newValidationError(
      "color",
      issuesOf(v.pipe(v.string(), v.minLength(1)), ""),
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
      issuesOf(v.pipe(v.string(), v.minLength(1)), ""),
    );
    const e2 = newValidationError(
      "name",
      issuesOf(v.pipe(v.string(), v.maxLength(0)), "a"),
    );

    // Act:
    const actual = mergeValidationError([e1, e2]);

    // Assert:
    expect(actual.issues.name.length).toBe(2);
  });
});
