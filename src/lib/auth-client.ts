import { passkeyClient } from "@better-auth/passkey/client";
import type { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "void/client";

// auth.ts の user.additionalFields と同じ定義。updateUser({ color }) の型を通すためのもの。
// inferAdditionalFields の実体は型情報だけを持つ空のプラグイン。関数を import すると
// プラグイン全体の入口を読み込んで SSR（開発サーバー）で解決に失敗するので、型だけ借りて自前で作る
type ColorFields = ReturnType<
  typeof inferAdditionalFields<
    unknown,
    { user: { color: { type: "string"; required: false } } }
  >
>;
const additionalFields = {
  id: "additional-fields-client",
  version: "",
  $InferServerPlugin: {},
} as unknown as ColorFields;

// Void 標準の auth クライアントに passkey プラグインなどを追加したもの
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient(), additionalFields],
});
