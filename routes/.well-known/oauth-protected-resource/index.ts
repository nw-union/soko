import { defineHandler } from "void";
import { protectedResourceMetadata } from "../../../server/mcp/http.ts";

// パスを付けずに探すクライアントのため、ルートにも同じものを置く（soko のリソースは /api/mcp だけ）
export const GET = defineHandler((c) =>
  c.json(protectedResourceMetadata(new URL(c.req.url).origin), 200, {
    "Cache-Control": "public, max-age=300",
  }),
);
