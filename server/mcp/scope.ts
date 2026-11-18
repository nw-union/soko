// MCP（/api/mcp）の OAuth のスコープと、リソース（RFC 8707）の URL。
// auth.ts（Void の CLI から Node で読まれる）からも使うので、Vite や Void のものを import しない

/** MCP のツールの権限。同意画面では videos:read だけを既定でオンにする */
export const MCP_SCOPES = [
  // 動画・プレイリスト・概要欄・自分の未視聴の本数を読む
  "videos:read",
  // 自分の視聴記録を付ける・外す
  "watches:write",
  // 同期するプレイリストを足す（全員のホームに影響する）
  "playlists:write",
  // 差分の同期を今すぐ実行する（全員に通知が飛ぶ・YouTube の割り当てを使う）
  "sync:run",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/** リフレッシュトークンを出すためのスコープ（OIDC の offline_access） */
export const OFFLINE_ACCESS = "offline_access";

/** クライアントが要求できるスコープのすべて */
export const OAUTH_SCOPES = [...MCP_SCOPES, OFFLINE_ACCESS];

/** 同意画面で、要求されていても既定でチェックを外すスコープ（書き込み） */
export const WRITE_SCOPES: readonly McpScope[] = [
  "watches:write",
  "playlists:write",
  "sync:run",
];

export const isMcpScope = (s: string): s is McpScope =>
  (MCP_SCOPES as readonly string[]).includes(s);

/** MCP のエンドポイントのパス */
export const MCP_PATH = "/api/mcp";
/** better-auth のパス（Void の既定）。OAuth の発行者（iss）は origin + これ */
export const AUTH_PATH = "/api/auth";

/** origin（https://soko.nw-union.net など）から、リソースの URL（トークンの aud）を作る */
export const mcpResource = (origin: string) => `${origin}${MCP_PATH}`;
/** origin から、OAuth の発行者（iss）を作る */
export const oauthIssuer = (origin: string) => `${origin}${AUTH_PATH}`;
