import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
import { bytesToBase64url } from "../../../lib/base64url.ts";
import { mustUserId } from "../../shared/vo.test.ts";
import type { PushRepositoryPort } from "../port.ts";
import type { NewSubscription, VapidKeys } from "../type.ts";
import {
  newSubscriptionWorkflow,
  validateEndpointToDelete,
  validateSubscription,
} from "./subscription.ts";

const VAPID: VapidKeys = {
  publicKey: "PUBLIC",
  privateKey: "PRIVATE",
  subject: "mailto:a@example.com",
};

const deviceKeys = async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  return {
    p256dh: bytesToBase64url(
      new Uint8Array(
        (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
      ),
    ),
    auth: bytesToBase64url(new Uint8Array(16).fill(1)),
  };
};

// テストで使わないリポジトリのメソッド. 呼ばれたら失敗させる
const notUsed = (): never => {
  throw new Error("このテストでは使わない");
};

const newFakes = (init: { vapid?: VapidKeys | null } = {}) => {
  const upserted: NewSubscription[] = [];
  const trimmed: [string, number][] = [];
  const deleted: [string, string][] = [];

  const repo: PushRepositoryPort = {
    upsertSubscription: (s) => {
      upserted.push(s);
      return okAsync(undefined);
    },
    trimSubscriptions: (user, keep) => {
      trimmed.push([user, keep]);
      return okAsync(undefined);
    },
    deleteSubscription: (user, endpoint) => {
      deleted.push([user, endpoint]);
      return okAsync(undefined);
    },
    listSubscriptions: notUsed,
    deleteSubscriptions: notUsed,
    claimUnnotifiedVideos: notUsed,
  };
  return {
    wf: newSubscriptionWorkflow(
      repo,
      init.vapid === undefined ? VAPID : init.vapid,
    ),
    upserted,
    trimmed,
    deleted,
  };
};

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

// ----------------------------------------------------------------------------
// subscribe / unsubscribe
// ----------------------------------------------------------------------------
describe("subscribe", () => {
  it("購読を保存し, 1 人 10 件を超えた古い購読を消す", async () => {
    // Arrange:
    const { wf, upserted, trimmed } = newFakes();
    const keys = await deviceKeys();

    // Act:
    const actual = await wf.subscribe({
      userId: "user1",
      body: { endpoint: "https://fcm.googleapis.com/x", keys },
    });

    // Assert:
    expect(actual.isOk()).toBeTrue();
    expect(upserted).toHaveLength(1);
    expect(trimmed).toEqual([["user1", 10]]);
  });

  it("購読の内容が正しくない場合, ValidationError となり, 保存しない", async () => {
    // Arrange:
    const { wf, upserted } = newFakes();

    // Act:
    const actual = await wf.subscribe({ userId: "user1", body: {} });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
    expect(upserted).toHaveLength(0);
  });
});

describe("unsubscribe", () => {
  it("自分の購読を消す", async () => {
    // Arrange:
    const { wf, deleted } = newFakes();

    // Act:
    await wf.unsubscribe({ userId: "user1", endpoint: "https://x" });

    // Assert:
    expect(deleted).toEqual([["user1", "https://x"]]);
  });
});

describe("getPublicKey", () => {
  it("鍵があれば公開鍵を返す", async () => {
    // Act:
    const actual = await newSubscriptionWorkflow({} as never, {
      publicKey: "PUBLIC",
      privateKey: "PRIVATE",
      subject: "mailto:test@example.com",
    }).getPublicKey();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ publicKey: "PUBLIC" });
  });

  it("鍵がなければ null を返す", async () => {
    // Act:
    const actual = await newSubscriptionWorkflow(
      {} as never,
      null,
    ).getPublicKey();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ publicKey: null });
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
