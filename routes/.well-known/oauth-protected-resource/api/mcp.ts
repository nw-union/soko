import { defineHandler } from "void";
import { protectedResourceMetadata } from "../../../../server/mcp/http.ts";

// RFC 9728: /api/mcp の Protected Resource Metadata。MCP のクライアントは 401 からここをたどって、認可サーバーを知る
export const GET = defineHandler((c) =>
  c.json(protectedResourceMetadata(new URL(c.req.url).origin), 200, {
    "Cache-Control": "public, max-age=300",
  }),
);
