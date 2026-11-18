// OAuth の認可の途中の画面（/login・/oauth/consent）で、認可サーバーが付けた署名付きのクエリを取り出す。
// better-auth の oauth-provider のクライアントプラグイン（@better-auth/oauth-provider/client）と同じ処理。
// あのプラグインは better-auth/client/plugins の入口を読み込み、SSR（開発サーバー）で解決に失敗するので、自前で持つ

const SIGNED_PARAM_NAMES = "ba_param";

/**
 * 署名付きのクエリ（sig と、署名した項目だけ）. 認可の途中の画面でなければ undefined
 */
export const signedOAuthQuery = (search: string): string | undefined => {
  const params = new URLSearchParams(search);
  if (!params.has("sig")) return;
  const names = new Set(params.getAll(SIGNED_PARAM_NAMES));
  if (names.size === 0) return;
  const signed = new URLSearchParams();
  for (const [key, value] of params.entries())
    if (key === "sig" || key === SIGNED_PARAM_NAMES || names.has(key))
      signed.append(key, value);
  return signed.toString();
};

/** 認可の途中か（署名付きのクエリがあるか） */
export const isOAuthFlow = (search: string) =>
  signedOAuthQuery(search) !== undefined;
