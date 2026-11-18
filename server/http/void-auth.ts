// Void がリクエストごとに作る better-auth のインスタンスを取り出す。
// Void は公開の API でインスタンスを渡さないので、認証のミドルウェアが Context に置く "__voidAuth"（Void の内部）を読む。
// Void を更新して取れなくなったら、ここで分かるように例外にする（/api/mcp と .well-known が 500 になる）
import type { JSONWebKeySet } from "jose";

type VoidAuth = {
  handler: (request: Request) => Promise<Response>;
  api: {
    // jwt プラグイン（auth.ts）: アクセストークンの検証に使う公開鍵
    getJwks: () => Promise<JSONWebKeySet>;
    // oauth-provider（auth.ts）: /.well-known/oauth-authorization-server の中身
    getOAuthServerConfig: (...args: unknown[]) => unknown;
    // oauth-provider（auth.ts）: 同意画面に出すクライアントの名前など（自己申告）
    getOAuthClientPublic: (args: {
      query: { client_id: string };
      headers: Headers;
    }) => Promise<{
      client_name?: string;
      client_uri?: string;
      logo_uri?: string;
    }>;
  };
};

type HasGet = { get: (key: never) => unknown };

const isVoidAuth = (v: unknown): v is VoidAuth => {
  const api = (v as { api?: Record<string, unknown> } | null)?.api;
  return (
    typeof api?.getJwks === "function" &&
    typeof api?.getOAuthServerConfig === "function" &&
    typeof api?.getOAuthClientPublic === "function"
  );
};

export const voidAuth = (c: HasGet): VoidAuth => {
  const auth = (c.get as (key: string) => unknown)("__voidAuth");
  if (!isVoidAuth(auth))
    throw new Error(
      "void-auth: better-auth のインスタンス（__voidAuth）を取得できません",
    );
  return auth;
};
