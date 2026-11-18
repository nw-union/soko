// /api/mcp と .well-known の HTTP の決まりごと（ヘッダー・401 のチャレンジ・メタデータ）
import { MCP_PATH, mcpResource, OAUTH_SCOPES, oauthIssuer } from "./scope.ts";

/** リクエストの本文の上限（JSON-RPC 1 件には十分） */
export const MAX_BODY_BYTES = 64 * 1024;

/** MCP の応答に付けるヘッダー. キャッシュさせない（Void が自動で付けるのは Cookie のセッションがあるときだけ） */
export const mcpHeaders = (
  extra: Record<string, string> = {},
): Record<string, string> => ({ "Cache-Control": "no-store", ...extra });

/** RFC 9728 の Protected Resource Metadata の URL（パス付きのリソースなので、パスを後ろに付ける） */
export const protectedResourceMetadataUrl = (origin: string) =>
  `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;

/**
 * 401 の WWW-Authenticate. クライアントはここからメタデータをたどって認可の流れに入る.
 * スコープは, 要求してほしいもの（書き込みは同意画面で既定でオフにする）
 */
export const bearerChallenge = (origin: string, invalid: boolean) =>
  [
    `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}"`,
    `scope="${OAUTH_SCOPES.join(" ")}"`,
    ...(invalid ? ['error="invalid_token"'] : []),
  ].join(", ");

/** RFC 9728 の Protected Resource Metadata */
export const protectedResourceMetadata = (origin: string) => ({
  resource: mcpResource(origin),
  authorization_servers: [oauthIssuer(origin)],
  scopes_supported: OAUTH_SCOPES,
  bearer_methods_supported: ["header"],
  resource_name: "soko",
});
