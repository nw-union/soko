import { describe, expect, it } from "bun:test";
import { newNotificationQueries } from "./query.ts";

describe("getPublicKey", () => {
  it("鍵があれば公開鍵を返す", async () => {
    // Act:
    const actual = await newNotificationQueries({
      publicKey: "PUBLIC",
      privateKey: "PRIVATE",
      subject: "mailto:test@example.com",
    }).getPublicKey();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ publicKey: "PUBLIC" });
  });

  it("鍵がなければ null を返す", async () => {
    // Act:
    const actual = await newNotificationQueries(null).getPublicKey();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ publicKey: null });
  });
});
