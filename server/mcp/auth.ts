// /api/mcp のアクセストークン（OAuth の JWT）の検証。
// トークンは better-auth の oauth-provider（auth.ts）が発行し、jwt プラグインの鍵で署名している。
// Cookie のセッションは使わない（Authorization: Bearer だけ）。ユーザーはトークンの sub からだけ決める
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import {
  isMcpScope,
  type McpScope,
  mcpResource,
  oauthIssuer,
} from "./scope.ts";

/** トークンから決まる、MCP を呼んでいる人とアプリ */
export type McpPrincipal = {
  userId: string;
  // 登録日時（ISO 8601）。ホームの New を決めるのに使う（auth.ts の customAccessTokenClaims）
  joinedAt: string;
  // OAuth のクライアント ID（監査ログ用）
  clientId: string;
  // このトークンで使えるスコープ（MCP のものだけ）
  scopes: McpScope[];
};

/**
 * Authorization ヘッダーから Bearer トークンを取り出す. なければ null
 */
export const parseBearer = (header: string | null | undefined) => {
  const m = /^Bearer[ ]+([A-Za-z0-9\-._~+/]+=*)$/i.exec(header?.trim() ?? "");
  return m?.[1] ?? null;
};

/**
 * アクセストークンを検証する関数を作る.
 * 署名（jwks）・期限・発行者（iss）・宛先（aud = この origin の /api/mcp）・種類（typ: at+jwt）を確かめ,
 * ユーザーのトークン（sub・joined_at がある）でなければ null
 */
export const newAccessTokenVerifier =
  (origin: string, getJwks: () => Promise<JSONWebKeySet>) =>
  async (token: string): Promise<McpPrincipal | null> => {
    try {
      const { payload } = await jwtVerify(
        token,
        createLocalJWKSet(await getJwks()),
        {
          issuer: oauthIssuer(origin),
          audience: mcpResource(origin),
          typ: "at+jwt",
          requiredClaims: ["exp", "sub"],
        },
      );
      const { sub, joined_at, azp, client_id, scope } = payload;
      const clientId = typeof azp === "string" ? azp : client_id;
      if (
        typeof sub !== "string" ||
        typeof joined_at !== "string" ||
        typeof clientId !== "string"
      )
        return null;
      const scopes =
        typeof scope === "string"
          ? scope.split(" ").filter((s): s is McpScope => isMcpScope(s))
          : [];
      return { userId: sub, joinedAt: joined_at, clientId, scopes };
    } catch {
      // 署名・期限・iss・aud・typ のどれかが違う
      return null;
    }
  };
