import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { defineHandler } from "void";
import { voidAuth } from "../../../../server/http/void-auth.ts";

// RFC 8414: 認可サーバーのメタデータ。発行者が <origin>/api/auth なので、パスを後ろに付けた場所に置く
export const GET = defineHandler((c) =>
  oauthProviderAuthServerMetadata(voidAuth(c))(c.req.raw),
);
