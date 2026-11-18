import { describe, expect, test } from "bun:test";
import { isAllowedRedirectUri } from "./redirect.ts";

describe("isAllowedRedirectUri", () => {
  test.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "http://localhost:33418/callback",
    "http://127.0.0.1:6274/oauth/callback",
    "http://[::1]:8080/cb",
  ])("許可する: %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  test.each([
    // 知らないホスト・似たホスト
    "https://evil.example.com/cb",
    "https://claude.ai.evil.example.com/cb",
    "https://evilclaude.ai/cb",
    // HTTP の外部ホスト
    "http://claude.ai/api/mcp/auth_callback",
    // ポート付きの HTTPS
    "https://claude.ai:8443/cb",
    // 認証情報・フラグメント
    "https://user:pass@claude.ai/cb",
    "https://claude.ai/cb#frag",
    // 独自スキーム・壊れた URL
    "javascript:alert(1)",
    "myapp://callback",
    "not a url",
  ])("拒否する: %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });
});
