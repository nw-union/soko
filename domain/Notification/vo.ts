import { type InferVo, v } from "@nw-union/nw-utils/lib/vo";
import { check, newVo } from "../shared/vo.ts";

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
export const newPushEndpoint = newVo(
  "PushEndpoint",
  v.chain(v.string, v.maxLength(1024), check(isPushEndpoint)),
);
export type PushEndpoint = InferVo<typeof newPushEndpoint>;

/**
 * PushP256dh 端末の公開鍵 (base64url). 形の確認だけで, 曲線上の点かは logic.ts の validateSubscription で確かめる
 */
export const newPushP256dh = newVo(
  "PushP256dh",
  v.chain(v.string, v.maxLength(200), v.regex(BASE64URL)),
);
export type PushP256dh = InferVo<typeof newPushP256dh>;

/**
 * PushAuth 端末の認証用の乱数 (base64url)
 */
export const newPushAuth = newVo(
  "PushAuth",
  v.chain(v.string, v.maxLength(100), v.regex(BASE64URL)),
);
export type PushAuth = InferVo<typeof newPushAuth>;
