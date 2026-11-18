import { match } from "@nw-union/nw-utils/lib/match";
import { defineHandler, defineHead, type InferProps } from "void";
import { getSession } from "void/auth";
import { container } from "../../server/container.ts";
import { voidAuth } from "../../server/http/void-auth.ts";

export type Props = InferProps<typeof loader>;

// 外部のアプリ（MCP のクライアント）に soko を使う許可を出す画面。
// 認可サーバー（auth.ts の oauthProvider）が、署名付きのクエリ（client_id・scope・redirect_uri など）を付けてここへ送る。
// ここで出す値は表示のためだけ。許可（POST /api/auth/oauth2/consent）のときに、サーバーが署名を確かめる
export const loader = defineHandler(async (c) => {
  const state = getSession();
  if (!state) return c.redirect("/login");

  const clientId = c.req.query("client_id") ?? "";
  // クライアントの名前などは、登録のときにクライアントが名乗ったもの（自己申告）
  const client = clientId
    ? await voidAuth(c)
        .api.getOAuthClientPublic({
          query: { client_id: clientId },
          headers: c.req.raw.headers,
        })
        .catch(() => null)
    : null;

  // リダイレクト先のホスト（認可コードの送り先）。利用者が見て判断できるように出す
  let redirectHost: string | null = null;
  try {
    redirectHost = new URL(c.req.query("redirect_uri") ?? "").host || null;
  } catch {
    redirectHost = null;
  }

  // 長く使えるトークンを渡すので、ログインし直したばかりのセッションでだけ許可できる（auth.ts の hooks でも確かめる）
  const fresh = match(
    await container().memberUsecase.checkOAuthConsent({
      sessionCreatedAt: new Date(state.session.createdAt),
    }),
  )
    .ok(() => true)
    .err(() => false)
    .exhaustive();

  return {
    clientName: client?.client_name ?? null,
    clientUri: client?.client_uri ?? null,
    known: client !== null,
    redirectHost,
    scopes: (c.req.query("scope") ?? "").split(" ").filter((s) => s !== ""),
    fresh,
  };
});

export const head = defineHead(() => ({ title: "アプリの接続 | Soko" }));
