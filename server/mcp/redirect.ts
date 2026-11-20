// OAuth のリダイレクト先の許可リスト。auth.ts（Void の CLI から Node で読まれる）からも使う。
// better-auth は「クライアントの登録どおりか」を確かめる。ここではさらに、送り先を
// 使うクライアント（Claude・ChatGPT のホスト、Muse のコールバックの URL）と、手元のアプリ（ループバック）に限る。
// 誰でもクライアントを登録できる（DCR）ので、知らないサイトに認可コードを渡さないため

/** HTTPS で許可するホスト（完全一致）。クライアントのコールバックの URL が変わったらここを直す */
export const ALLOWED_REDIRECT_HOSTS: readonly string[] = [
  "claude.ai",
  "claude.com",
  "chatgpt.com",
  "chat.openai.com",
];

/**
 * HTTPS で許可するコールバックの URL（URL 全体の完全一致。クエリも付けられない）。
 * ホストごと許可すると、同じホストの別のページにも認可コードを送れてしまうので、ホストを丸ごと許せないものはここに書く
 */
export const ALLOWED_REDIRECT_URIS: readonly string[] = [
  // Muse（Meta の AI エージェント）
  "https://agent.meta.ai/api/hatch/oauth/callback",
];

/** ネイティブアプリ（Claude Code・MCP Inspector など）のループバック */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * リダイレクト先として許可するか.
 * HTTPS の許可したホスト（ポートなし）か許可した URL（完全一致）, HTTP のループバックだけ.
 * 認証情報やフラグメントの付いた URL は拒否する.
 * ここを通っても, better-auth がクライアントに登録された redirect_uris との一致も確かめる（auth.ts の validateRedirectUri）
 */
export const isAllowedRedirectUri = (uri: string): boolean => {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "")
    return false;
  if (ALLOWED_REDIRECT_URIS.includes(uri)) return true;
  if (url.protocol === "https:")
    return url.port === "" && ALLOWED_REDIRECT_HOSTS.includes(url.hostname);
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return false;
};
