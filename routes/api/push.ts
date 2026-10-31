import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { db, sql } from "void/db";
import { vapidKeys } from "../../src/lib/push-notify";
import {
  isPushEndpoint,
  isValidSubscriptionKeys,
} from "../../src/lib/web-push";

// 新着動画のプッシュ通知の購読（端末ごと）。購読の作成はブラウザ（src/lib/push.ts）が行い、ここには結果を保存する

const BASE64URL = /^[A-Za-z0-9_-]+$/;
// 1 人が持てる購読（端末）の数。超えたら古いものから消す。
// 購読が増えすぎると、cron 1 回の送信数が Workers のサブリクエストの上限に届いて、全員に届かなくなるため
const MAX_SUBSCRIPTIONS_PER_USER = 10;

// 購読に使う VAPID の公開鍵。サーバーに鍵がなければ null（通知の設定を出さない）
export const GET = defineHandler(async (c) => {
  requireAuth(c);
  return { publicKey: vapidKeys()?.publicKey ?? null };
});

// 購読を保存する。同じ端末（endpoint）なら、ログインしているユーザーと鍵を上書きする。
// アプリを開くたびにも送られ、プッシュサービス側で購読が変わったときに追いつく
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const body = (await c.req.json().catch(() => null)) as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  } | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (
    typeof endpoint !== "string" ||
    endpoint.length > 1024 ||
    !isPushEndpoint(endpoint) ||
    typeof p256dh !== "string" ||
    p256dh.length > 200 ||
    !BASE64URL.test(p256dh) ||
    typeof auth !== "string" ||
    auth.length > 100 ||
    !BASE64URL.test(auth) ||
    !(await isValidSubscriptionKeys(p256dh, auth))
  )
    return c.json({ message: "購読の内容が正しくありません" }, 400);
  await db.run(sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (${user.id}, ${endpoint}, ${p256dh}, ${auth})
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`);
  await db.run(sql`
    DELETE FROM push_subscriptions
    WHERE user_id = ${user.id} AND id NOT IN (
      SELECT id FROM push_subscriptions WHERE user_id = ${user.id}
      ORDER BY id DESC LIMIT ${MAX_SUBSCRIPTIONS_PER_USER})`);
  return null;
});

// 購読を消す（通知をオフにしたとき・ログアウトするとき）
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  const endpoint = c.req.query("endpoint");
  if (!endpoint) return c.json({ message: "endpoint がありません" }, 400);
  await db.run(
    sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${user.id}`,
  );
  return null;
});
