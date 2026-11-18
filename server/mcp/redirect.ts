// OAuth のリダイレクト先の許可リスト。auth.ts（Void の CLI から Node で読まれる）からも使う。
// better-auth は「クライアントの登録どおりか」を確かめる。ここではさらに、送り先を
// 使うクライアント（Claude・ChatGPT）のホストと、手元のアプリ（ループバック）に限る。
// 誰でもクライアントを登録できる（DCR）ので、知らないサイトに認可コードを渡さないため

/** HTTPS で許可するホスト（完全一致）。クライアントのコールバックの URL が変わったらここを直す */
export const ALLOWED_REDIRECT_HOSTS: readonly string[] = [
  "claude.ai",
  "claude.com",
  "chatgpt.com",
  "chat.openai.com",
];

/** ネイティブアプリ（Claude Code・MCP Inspector など）のループバック */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * リダイレクト先として許可するか.
 * HTTPS の許可したホスト（ポートなし）か, HTTP のループバックだけ. 認証情報やフラグメントの付いた URL は拒否する
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
  if (url.protocol === "https:")
    return url.port === "" && ALLOWED_REDIRECT_HOSTS.includes(url.hostname);
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return false;
};
