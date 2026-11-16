import * as v from "valibot";
import { newVo } from "../shared/vo.ts";

// 送れる先は, ブラウザのプッシュサービスだけにする. 購読はユーザーが送ってくるので,
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

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * PushEndpoint 購読の送り先 (プッシュサービスの URL)
 */
const pushEndpoint = v.pipe(
  v.string(),
  v.maxLength(1024),
  v.check(isPushEndpoint),
  v.brand("PushEndpoint"),
);
export type PushEndpoint = v.InferOutput<typeof pushEndpoint>;
export const newPushEndpoint = newVo(pushEndpoint, "PushEndpoint");

/**
 * PushP256dh 端末の公開鍵 (base64url). 形の確認だけで, 曲線上の点かは logic.ts の validateSubscription で確かめる
 */
const pushP256dh = v.pipe(
  v.string(),
  v.maxLength(200),
  v.regex(BASE64URL),
  v.brand("PushP256dh"),
);
export type PushP256dh = v.InferOutput<typeof pushP256dh>;
export const newPushP256dh = newVo(pushP256dh, "PushP256dh");

/**
 * PushAuth 端末の認証用の乱数 (base64url)
 */
const pushAuth = v.pipe(
  v.string(),
  v.maxLength(100),
  v.regex(BASE64URL),
  v.brand("PushAuth"),
);
export type PushAuth = v.InferOutput<typeof pushAuth>;
export const newPushAuth = newVo(pushAuth, "PushAuth");
