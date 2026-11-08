import { z } from "zod";
import { newVo } from "../vo.ts";

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
const pushEndpoint = z
  .string()
  .max(1024)
  .refine(isPushEndpoint)
  .brand("PushEndpoint");
export type PushEndpoint = z.infer<typeof pushEndpoint>;
export const newPushEndpoint = newVo(pushEndpoint, "PushEndpoint");

/**
 * PushP256dh 端末の公開鍵 (base64url). 形の確認だけで, 曲線上の点かは logic.ts の validateSubscription で確かめる
 */
const pushP256dh = z.string().max(200).regex(BASE64URL).brand("PushP256dh");
export type PushP256dh = z.infer<typeof pushP256dh>;
export const newPushP256dh = newVo(pushP256dh, "PushP256dh");

/**
 * PushAuth 端末の認証用の乱数 (base64url)
 */
const pushAuth = z.string().max(100).regex(BASE64URL).brand("PushAuth");
export type PushAuth = z.infer<typeof pushAuth>;
export const newPushAuth = newVo(pushAuth, "PushAuth");
