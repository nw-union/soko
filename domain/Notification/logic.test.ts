import { describe, expect, it } from "bun:test";
import { bytesToBase64url } from "../../lib/base64url.ts";
import { mustUserId } from "../shared/vo.test.ts";
import {
  buildPayload,
  classifySendResult,
  selectRecent,
  validateEndpointToDelete,
  validateSubscription,
} from "./logic.ts";
import type { ClaimedVideo, StoredSubscription } from "./type.ts";
import { isPushEndpoint } from "./vo.ts";

// ブラウザが作るのと同じ, 端末の鍵 (P-256 の非圧縮の公開鍵と, 16 バイトの乱数)
const newDeviceKeys = async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  return {
    pair,
    p256dh: bytesToBase64url(raw),
    auth: bytesToBase64url(crypto.getRandomValues(new Uint8Array(16))),
  };
};

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const NOW = new Date("2026-11-04T00:00:00Z");
const video = (id: string, publishedAt: string | null): ClaimedVideo => ({
  youtubeId: id,
  title: `動画 ${id}`,
  publishedAt,
});
const sub: StoredSubscription = {
  id: 7,
  userId: "user1",
  endpoint: ENDPOINT,
  p256dh: "x",
  auth: "y",
};

// ----------------------------------------------------------------------------
// Domain Logic
// ----------------------------------------------------------------------------
describe("selectRecent", () => {
  it("投稿から 3 日以内の動画だけを, 新しい順に選ぶ", () => {
    // Arrange:
    const claimed = [
      video("a", "2026-11-01T00:00:00Z"), // ちょうど 3 日前
      video("b", "2026-10-31T23:59:59Z"), // 3 日より前
      video("c", "2026-11-03T00:00:00Z"),
      video("d", null),
    ];

    // Act:
    const actual = selectRecent(claimed, NOW);

    // Assert:
    expect(actual.map((v) => v.youtubeId)).toEqual(["c", "a"]);
  });
});

describe("buildPayload", () => {
  it("1 本なら「新着動画」で, 押すとその動画を開く", () => {
    expect(buildPayload([video("abc", null)])).toEqual({
      title: "新着動画",
      body: "動画 abc",
      url: "/?v=abc",
    });
  });

  it("複数なら本数を出し, タイトルをつなげ, 押すと先頭 (いちばん新しい) の動画を開く", () => {
    // Act:
    const actual = buildPayload([video("a", null), video("b", null)]);

    // Assert:
    expect(actual).toEqual({
      title: "新着動画が 2 本",
      body: "動画 a / 動画 b",
      url: "/?v=a",
    });
  });

  it("本文は 200 文字に切る", () => {
    // Arrange:
    const long = { youtubeId: "a", title: "あ".repeat(300), publishedAt: null };

    // Act:
    const actual = buildPayload([long]);

    // Assert:
    expect(actual.body).toHaveLength(200);
    expect(actual.body.endsWith("…")).toBeTrue();
  });
});

describe("classifySendResult", () => {
  it.each([
    [201, { type: "Sent" }],
    [404, { type: "Gone", subscriptionId: 7 }],
    [410, { type: "Gone", subscriptionId: 7 }],
    [429, { type: "Failed", reason: "429" }],
    [500, { type: "Failed", reason: "500" }],
  ])("ステータス %d を分類する", (status, expected) => {
    expect(classifySendResult(sub, status)).toEqual(expected as never);
  });
});

// ----------------------------------------------------------------------------
// Validater
// ----------------------------------------------------------------------------
describe("isPushEndpoint", () => {
  it.each([
    ["FCM", ENDPOINT, true],
    ["Apple のサブドメイン", "https://web.push.apple.com/x", true],
    ["http", "http://fcm.googleapis.com/x", false],
    ["似た名前の別のホスト", "https://evilfcm.googleapis.com.example/x", false],
    ["許可していないホスト", "https://example.com/x", false],
  ])("%s", (_, url, expected) => {
    expect(isPushEndpoint(url)).toBe(expected);
  });
});

describe("validateSubscription", () => {
  it("ブラウザが作った購読なら, 通す", async () => {
    // Arrange:
    const { p256dh, auth } = await newDeviceKeys();

    // Act:
    const actual = await validateSubscription(mustUserId("user1"), {
      endpoint: ENDPOINT,
      keys: { p256dh, auth },
    });

    // Assert:
    expect(actual._unsafeUnwrap()).toMatchObject({
      type: "NewSubscription",
      endpoint: ENDPOINT,
      p256dh,
      auth,
    });
  });

  it.each([
    ["本文がない", async () => null],
    [
      "許可していない送り先",
      async () => {
        const { p256dh, auth } = await newDeviceKeys();
        return { endpoint: "https://example.com/x", keys: { p256dh, auth } };
      },
    ],
    [
      "公開鍵が曲線上の点でない",
      async () => {
        const { auth } = await newDeviceKeys();
        const bad = new Uint8Array(65).fill(1);
        bad[0] = 4;
        return {
          endpoint: ENDPOINT,
          keys: { p256dh: bytesToBase64url(bad), auth },
        };
      },
    ],
    [
      "auth が 16 バイトでない",
      async () => {
        const { p256dh } = await newDeviceKeys();
        return {
          endpoint: ENDPOINT,
          keys: { p256dh, auth: bytesToBase64url(new Uint8Array(8)) },
        };
      },
    ],
    [
      "base64url でない文字を含む",
      async () => ({ endpoint: ENDPOINT, keys: { p256dh: "a+b", auth: "c" } }),
    ],
  ])("%s場合, 同じ ValidationError となる", async (_, body) => {
    // Act:
    const actual = await validateSubscription(
      mustUserId("user1"),
      await body(),
    );

    // Assert:
    expect(actual._unsafeUnwrapErr().issues).toEqual({
      subscription: ["購読の内容が正しくありません"],
    });
  });
});

describe("validateEndpointToDelete", () => {
  it("空の場合, ValidationError となる", () => {
    expect(
      validateEndpointToDelete(undefined)._unsafeUnwrapErr().issues,
    ).toEqual({ endpoint: ["endpoint がありません"] });
  });
});
