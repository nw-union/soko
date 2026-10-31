// Web Push の送信（サーバー用）。npm の web-push は Node の crypto に依存して Workers で動かないので、
// WebCrypto だけで書く。暗号化は RFC 8291（aes128gcm）、送信者の認証は RFC 8292（VAPID）。

export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type VapidKeys = {
  // 非圧縮の公開鍵（65 バイト）の base64url
  publicKey: string;
  // 秘密鍵 d（32 バイト）の base64url
  privateKey: string;
  // 連絡先（mailto:… か https://…）
  subject: string;
};

// 送れる先は、ブラウザのプッシュサービスだけにする。購読はユーザーが送ってくるので、
// 任意の URL にサーバーから POST させないように
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "push.apple.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];

export const isPushEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      PUSH_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
};

export const base64urlToBytes = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

// 購読の鍵が、送るときに暗号化できる形か（p256dh は P-256 の非圧縮の公開鍵 65 バイト、auth は 16 バイト）。
// 壊れた鍵の購読は、送るたびに暗号化で失敗し続けるので、保存する前に弾く
export const isValidSubscriptionKeys = async (p256dh: string, auth: string) => {
  try {
    const publicKey = base64urlToBytes(p256dh);
    if (publicKey.length !== 65 || publicKey[0] !== 4) return false;
    if (base64urlToBytes(auth).length !== 16) return false;
    // 曲線上の点でなければ、ここで例外になる
    await crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    return true;
  } catch {
    return false;
  }
};

export const bytesToBase64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

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
    // 有効期限は 24 時間以内にする（Apple はそれより長いと受け付けない）
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
