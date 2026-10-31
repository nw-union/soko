import { defineMiddleware } from "void";
import { getUser } from "void/auth";
import { db, sql } from "void/db";
import { resolveColor } from "../src/lib/color";
import { isHttpUrl } from "../src/lib/url";

declare module "void" {
  interface CloudContextVariables {
    // 全ページで useShared() から参照できるログインユーザー（画面表示に必要な最小限）
    shared: {
      auth: {
        user: { name: string; color: string; image: string | null } | null;
      };
    };
  }
}

export default defineMiddleware(async (c, next) => {
  const user = getUser() as
    | (ReturnType<typeof getUser> & { color?: string | null })
    | null;
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
  const isFile =
    /\.[a-z0-9]+$/i.test(path) ||
    /^\/(@|pages\/|src\/|node_modules\/|__void)/.test(path);
  const isPublic =
    path === "/login" ||
    path === "/welcome" ||
    path.startsWith("/api/") ||
    isFile;
  if (!isPublic && c.req.method === "GET") {
    if (!user) return c.redirect("/login");
    // パスキーがログインの唯一の手段。まだ作っていない（登録の途中の）人は、作るまで /welcome から出さない
    const [row] = await db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM passkey WHERE userId = ${user.id}`,
    );
    if (!row?.count) return c.redirect("/welcome");
  }
  await next();
});
