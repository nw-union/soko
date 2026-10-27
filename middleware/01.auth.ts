import { defineMiddleware } from "void";
import { getUser } from "void/auth";
import { resolveColor } from "../src/lib/color";
import { isHttpUrl } from "../src/lib/url";

declare module "void" {
  interface CloudContextVariables {
    // 全ページで useShared() から参照できるログインユーザー（画面表示に必要な最小限）
    shared: { auth: { user: { name: string; color: string; image: string | null } | null } };
  }
}

export default defineMiddleware(async (c, next) => {
  const user = getUser() as (ReturnType<typeof getUser> & { color?: string | null }) | null;
  c.set("shared", {
    auth: {
      user: user
        ? {
            name: user.name,
            color: resolveColor(user.color, user.id),
            // 画像の URL。http(s) 以外は使わない
            image: user.image && isHttpUrl(user.image) ? user.image : null,
          }
        : null,
    },
  });

  // アプリのページはログイン必須。ページごとに loader で確認しなくてよいようにここで止める。
  // ログイン前でも開ける画面と API は除く
  const path = c.req.path;
  // ファイル（拡張子つき）や開発サーバーのモジュール（/pages/…、/src/…、/@vite/… など）も止めない。
  // 止めるとログイン画面のスクリプトまで /login へのリダイレクトになり、画面が動かなくなる
  const isFile = /\.[a-z0-9]+$/i.test(path) || /^\/(@|pages\/|src\/|node_modules\/|__void)/.test(path);
  const isPublic = path === "/login" || path === "/welcome" || path.startsWith("/api/") || isFile;
  if (!user && !isPublic && c.req.method === "GET") {
    return c.redirect("/login");
  }
  await next();
});
