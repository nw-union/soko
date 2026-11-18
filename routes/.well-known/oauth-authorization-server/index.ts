import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { defineHandler } from "void";
import { voidAuth } from "../../../server/http/void-auth.ts";

// パスを付けずに探すクライアントのため、ルートにも同じものを置く
export const GET = defineHandler((c) =>
  oauthProviderAuthServerMetadata(voidAuth(c))(c.req.raw),
);
