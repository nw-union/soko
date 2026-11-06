// Web Push の送信。npm の web-push は Node の crypto に依存して Workers で動かないので、
// WebCrypto だけで書く。暗号化は RFC 8291（aes128gcm）、送信者の認証は RFC 8292（VAPID）。
// encrypt 以降は src/lib/web-push.ts から変えずに移したもの
import { ResultAsync } from "neverthrow";
import { base64urlToBytes, bytesToBase64url } from "../../domain/base64url.ts";
import type { PushSenderPort } from "../../domain/Push/port.ts";
import type { VapidKeys } from "../../domain/Push/type.ts";

type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

// WebCrypto に渡せるバイト列（SharedArrayBuffer でないもの）
type Bytes = Uint8Array<ArrayBuffer>;

const concat = (...parts: Bytes[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const text = (value: string) => new TextEncoder().encode(value);

const hmac = async (key: Bytes, data: Bytes) => {
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
};

// HKDF の 1 ブロック分（32 バイト以下を取り出すときはこれで足りる）
const hkdf = async (salt: Bytes, ikm: Bytes, info: Bytes, length: number) => {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
};

// RFC 8291: 端末の公開鍵と auth で、本文を暗号化する（レコードは 1 つ）
const encrypt = async (sub: PushSubscriptionKeys, payload: Bytes) => {
  const uaPublic = base64urlToBytes(sub.p256dh);
  const authSecret = base64urlToBytes(sub.auth);
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  // 送るたびに使い捨ての鍵ペアを作る
  const local = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer,
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaKey },
      local.privateKey,
      256,
    ),
  );

  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(text("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  // 末尾の 0x02 は「最後のレコード」の印（詰め物はなし）
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      concat(payload, new Uint8Array([2])),
    ),
  );

  // ヘッダー: salt(16) | レコードサイズ(4) | 鍵の長さ(1) | 送信側の公開鍵(65)
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
};

// RFC 8292: プッシュサービスの origin 宛ての、ES256 で署名した JWT
const vapidAuthorization = async (endpoint: string, vapid: VapidKeys) => {
  const publicKey = base64urlToBytes(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64url(publicKey.slice(1, 33)),
      y: bytesToBase64url(publicKey.slice(33, 65)),
      d: vapid.privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const encode = (value: object) =>
    bytesToBase64url(text(JSON.stringify(value)));
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(endpoint).origin,
    // 有効期限は 24 時間以内にする（Apple はそれより長いと受け付けない）。余裕を見て 12 時間にしている
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  })}`;
  // WebCrypto の ECDSA 署名は r || s の 64 バイトで、JWT の形式そのまま
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      text(unsigned),
    ),
  );
  return `vapid t=${unsigned}.${bytesToBase64url(signature)}, k=${vapid.publicKey}`;
};

// 1 件送る。プッシュサービスの応答をそのまま返す（404 / 410 は購読が無効になったという意味）
export const sendPush = async (
  sub: PushSubscriptionKeys,
  payload: object,
  vapid: VapidKeys,
  // 端末がオフラインのとき、プッシュサービスが預かっておく秒数
  ttl = 24 * 60 * 60,
) =>
  fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "normal",
    },
    body: await encrypt(sub, text(JSON.stringify(payload))),
  });

export const webPushSender: PushSenderPort = {
  send: (sub, payload, vapid) =>
    ResultAsync.fromPromise(sendPush(sub, payload, vapid), (e) =>
      String(e),
    ).map((res) => res.status),
};
