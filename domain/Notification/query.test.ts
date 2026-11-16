import { describe, expect, it } from "bun:test";
import { unwrap } from "../../lib/rslt-test.ts";
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
    expect(unwrap(actual)).toEqual({ publicKey: "PUBLIC" });
  });

  it("鍵がなければ null を返す", async () => {
    // Act:
    const actual = await newNotificationQueries(null).getPublicKey();

    // Assert:
    expect(unwrap(actual)).toEqual({ publicKey: null });
  });
});
