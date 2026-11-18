import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../server/container.ts";
import { respond } from "../../server/http/error.ts";

// 接続中のアプリ（MCP のクライアント。Claude・ChatGPT など）の一覧
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c);
  return respond(
    c,
    container().memberUsecase.listConnectedApps({ userId: user.id }),
    (view) => view,
  );
});

// アプリへの許可を取り消す（同意とリフレッシュトークンを消す。発行済みのアクセストークンは最長 1 時間で切れる）
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  return respond(
    c,
    container().memberUsecase.revokeConnectedApp({
      userId: user.id,
      clientId: c.req.query("clientId"),
    }),
    () => null,
  );
});
