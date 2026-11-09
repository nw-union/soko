import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../server/container.ts";
import { errorResponse } from "../../server/http/error.ts";

// 新着動画のプッシュ通知の購読（端末ごと）。購読の作成はブラウザ（src/lib/push.ts）が行い、ここには結果を保存する

// 購読に使う VAPID の公開鍵。サーバーに鍵がなければ null（通知の設定を出さない）
export const GET = defineHandler(async (c) => {
  // 認証
  requireAuth(c);
  // WF 実行: 購読に使う VAPID の公開鍵取得する
  return container()
    .notificationQueries.getPublicKey()
    .match(
      (evt) => evt,
      (e) => errorResponse(c, e),
    );
});

// 購読を保存する。同じ端末（endpoint）なら、ログインしているユーザーと鍵を上書きする。
// アプリを開くたびにも送られ、プッシュサービス側で購読が変わったときに追いつく
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  return container()
    .notificationWorkFlows.subscribe({ userId: user.id, body })
    .match(
      () => null,
      (e) => errorResponse(c, e),
    );
});

// 購読を消す（通知をオフにしたとき・ログアウトするとき）
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  return container()
    .notificationWorkFlows.unsubscribe({
      userId: user.id,
      endpoint: c.req.query("endpoint"),
    })
    .match(
      () => null,
      (e) => errorResponse(c, e),
    );
});
