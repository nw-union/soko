import { defineHandler } from "void";
import { container } from "../../server/container.ts";
import { voidAuth } from "../../server/http/void-auth.ts";
import { log } from "../../server/log/log.ts";
import { newAccessTokenVerifier } from "../../server/mcp/auth.ts";
import { gateMcpRequest } from "../../server/mcp/gate.ts";
import { handleMcpRequest } from "../../server/mcp/handler.ts";
import { mcpHeaders } from "../../server/mcp/http.ts";
import { runSyncNew } from "../../server/process/sync.ts";

// MCP のエンドポイント（Streamable HTTP・ステートレス）。設計は docs/design/mcp.md。
// 認証は OAuth のアクセストークン（Authorization: Bearer）だけ。Cookie のセッションでは通さない
// （ブラウザで soko にログインしている人が悪いページを開いても、ここは動かない）
export const POST = defineHandler(async (c) => {
  const origin = new URL(c.req.url).origin;
  const auth = voidAuth(c);
  const { memberUsecase, contentUsecase, checkRateLimit } = container();
  const gate = await gateMcpRequest(
    {
      origin,
      requestOrigin: c.req.header("origin"),
      contentLength: c.req.header("content-length"),
      authorization: c.req.header("authorization"),
    },
    {
      verify: newAccessTokenVerifier(origin, () => auth.api.getJwks()),
      memberStatus: (userId) => memberUsecase.getMemberStatus({ userId }),
      checkRateLimit,
      log: log(),
    },
  );
  if (gate.type === "Reject")
    return c.json(gate.body, gate.status, mcpHeaders(gate.headers));

  const res = await handleMcpRequest(c.req.raw, gate.principal, {
    content: contentUsecase,
    syncNew: runSyncNew,
    checkRateLimit,
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
