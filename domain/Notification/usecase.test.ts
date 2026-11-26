import { describe, expect, test } from "bun:test";
import { newNotificationUsecase } from "./usecase.ts";

describe("newNotificationUsecase", () => {
  test("コマンドと Query をまとめて返す", () => {
    const uc = newNotificationUsecase(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      null,
    );
    expect(Object.keys(uc).sort()).toEqual(
      ["subscribe", "unsubscribe", "notify", "getPublicKey"].sort(),
    );
  });
});
