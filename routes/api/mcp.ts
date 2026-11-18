import { defineHandler } from "void";
import { voidAuth } from "../../server/http/void-auth.ts";
import { log } from "../../server/log/log.ts";
import { newAccessTokenVerifier, parseBearer } from "../../server/mcp/auth.ts";
import { handleMcpRequest } from "../../server/mcp/handler.ts";
import {
  bearerChallenge,
  MAX_BODY_BYTES,
  mcpHeaders,
} from "../../server/mcp/http.ts";
import { container } from "../../server/container.ts";
import { runSyncNew } from "../../server/process/sync.ts";

// MCP のエンドポイント（Streamable HTTP・ステートレス）。設計は docs/design/mcp.md。
// 認証は OAuth のアクセストークン（Authorization: Bearer）だけ。Cookie のセッションでは通さない
// （ブラウザで soko にログインしている人が悪いページを開いても、ここは動かない）
export const POST = defineHandler(async (c) => {
  const origin = new URL(c.req.url).origin;
  // DNS リバインディング・ブラウザからの呼び出しの対策。Origin が付いていたら、自分のものだけ通す
  // （Claude・ChatGPT のサーバーや手元のアプリからのリクエストには、普通 Origin がない）
  const reqOrigin = c.req.header("origin");
  if (reqOrigin && reqOrigin !== origin)
    return c.json({ message: "Forbidden" }, 403, mcpHeaders());
  // 大きすぎる本文は読まない
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > MAX_BODY_BYTES)
    return c.json({ message: "Payload Too Large" }, 413, mcpHeaders());

  // 認証: 署名・期限・発行者・宛先（この /api/mcp）を確かめる
  const token = parseBearer(c.req.header("authorization"));
  const auth = voidAuth(c);
  const principal = token
    ? await newAccessTokenVerifier(origin, () => auth.api.getJwks())(token)
    : null;
  if (!principal) {
    if (token) log().info("mcp: アクセストークンを検証できませんでした");
    return c.json(
      { error: "invalid_token" },
      401,
      mcpHeaders({ "WWW-Authenticate": bearerChallenge(origin, !!token) }),
    );
  }

  const res = await handleMcpRequest(c.req.raw, principal, {
    content: container().contentUsecase,
    syncNew: runSyncNew,
    log: log(),
  });
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(mcpHeaders())) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});

// サーバーからの通知（SSE）とセッションは使わない（ステートレス）
const methodNotAllowed = defineHandler((c) =>
  c.json({ message: "Method Not Allowed" }, 405, mcpHeaders({ Allow: "POST" })),
);
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
