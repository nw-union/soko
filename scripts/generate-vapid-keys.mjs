#!/usr/bin/env bun
// 新着動画のプッシュ通知（Web Push）に使う VAPID の鍵ペアを作る（管理者用。最初に 1 回だけ）。
//
//   bun scripts/generate-vapid-keys.mjs
//
// 表示された値を、ローカルは .env に書き、本番は void secret put で入れる。
// VAPID_SUBJECT には連絡先（mailto:you@example.com か https://…）を入れる。
//
// 鍵を作り直すと、今ある購読には送れなくなる（各端末で通知をオンにし直す必要がある）
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const base64url = (bytes) => Buffer.from(bytes).toString("base64url");

// 公開鍵は非圧縮の 65 バイト、秘密鍵は d（32 バイト）。src/lib/web-push.ts が読む形
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
const { d } = await crypto.subtle.exportKey("jwk", privateKey);

console.log(`VAPID_PUBLIC_KEY=${base64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
console.log("VAPID_SUBJECT=mailto:");
