import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { match, P } from "@nw-union/nw-utils/lib/match";
import type { ResultAsync } from "@nw-union/nw-utils/lib/rslt";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { jwt } from "better-auth/plugins/jwt";
import { defineAuth } from "void/auth";
import { FRESH_AGE_SECONDS } from "./domain/Member/workflow/account.ts";
import { DEFAULT_INVITE_LIMIT } from "./domain/Member/workflow/invite.ts";
import type { AppError } from "./domain/shared/error.ts";
import { container } from "./server/container.ts";
import {
  INVITE_COOKIE,
  readInviteCookie,
} from "./server/http/invite-cookie.ts";
import { isAllowedRedirectUri } from "./server/mcp/redirect.ts";
import {
  MCP_SCOPES,
  mcpResource,
  OAUTH_SCOPES,
  oauthIssuer,
} from "./server/mcp/scope.ts";

// プロフィール（名前・イメージカラー・アイコン）と招待のルールは domain/ にある。ここは better-auth とつなぐだけ

// ---- 招待トークン ----
// 新規登録は、メンバーが発行した招待（invites テーブル）のトークンを持っている人だけができる。
// トークンは /api/invite/start で検証され、短命の Cookie に入る。その後の sign-up でユーザーを作る。
// ユーザー作成の直前（databaseHooks.user.create.before）で Cookie のトークンを使用済みにする。

// WorkFlow のエラーを better-auth のエラーにする。入力の誤りと権限の不足は、理由をそのまま返す
const toAPIError = (e: AppError) =>
  match(e)
    .with(
      { type: "ValidationError" },
      (e) =>
        new APIError("BAD_REQUEST", {
          message: Object.values(e.issues)[0]?.[0] ?? e.message,
        }),
    )
    .with(
      { type: "ForbiddenError" },
      (e) => new APIError("FORBIDDEN", { message: e.message, code: e.code }),
    )
    .with(
      P._,
      (e) =>
        new Error(`${e.type}: ${e.message}`, {
          cause: "cause" in e ? e.cause : undefined,
        }),
    )
    .exhaustive();

// WorkFlow の成功値を取り出す. 失敗なら better-auth のエラーにして throw する
const valueOrThrowAPIError = async <T>(
  r: ResultAsync<T, AppError>,
): Promise<T> =>
  match(await r)
    .ok((value) => value)
    .err((e) => {
      throw toAPIError(e);
    })
    .exhaustive();

export default defineAuth(({ defaults }) => {
  // OAuth の発行者とリソース（MCP）。Void の baseURL はリクエストの origin なので、ホストごとに別になる
  // （本番のドメインで発行したトークンは、別のホストの /api/mcp では使えない）
  // （Void の CLI から読まれるときなど、文字列でなければ localhost とみなす）
  const origin = new URL(
    typeof defaults.baseURL === "string"
      ? defaults.baseURL
      : "http://localhost:5173",
  ).origin;
  const resource = mcpResource(origin);
  return {
    ...defaults,
    // ログインはパスキーだけ。メール + パスワードは、招待コードでの登録時にユーザーを作るためだけに使う
    // （パスワードはブラウザが捨てるランダムな値で、誰も知らない）
    emailAndPassword: { enabled: true },
    // 登録（sign-up）以外のメール + パスワードの機能は使わないので、エンドポイントごと閉じる
    disabledPaths: [
      ...(defaults.disabledPaths ?? []),
      "/sign-in/email",
      "/change-password",
      "/change-email",
      "/verify-password",
      "/request-password-reset",
      "/reset-password",
      "/send-verification-email",
      "/verify-email",
    ],
    // パスキーの追加・削除とアカウントの削除は、この時間内にパスキーでログインし直したセッションでだけ受け付ける
    // （セッションが盗まれても、パスキーを差し替えて乗っ取られないように）。既定は 24 時間
    session: {
      ...defaults.session,
      freshAge: FRESH_AGE_SECONDS,
      // セッションとユーザーを署名つきの Cookie に 5 分持ち、その間はページを開くたびの DB の読み出し（D1 の primary への往復）をしない。
      // 代わりに、別の端末でのログアウトやアカウントの削除は、最大 5 分遅れて効く。
      // better-auth を通さずに user を変えたとき（アイコン画像）は、画面側で disableCookieCache を付けて読み直す（ProfileSheet.svelte）
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // イメージカラー（#rrggbb）。プロフィールで本人が変更できる
    user: {
      // プロフィール画面からアカウントを削除できる（HIG: 作れるなら削除もできるように）。
      // 削除の直前に、画面側でパスキーを使って本人確認し直す（セッションを新しくする）。
      // パスキー・セッションは user に連動して消える。発行した未使用の招待と、通知の購読、視聴記録もここで消す（使用済みの招待の記録は残す）
      deleteUser: {
        enabled: true,
        afterDelete: async (user) => {
          await valueOrThrowAPIError(
            container().memberUsecase.cleanupDeletedUser({
              userId: user.id,
              image: user.image,
            }),
          );
        },
      },
      additionalFields: {
        color: { type: "string", required: false },
        // 発行できる招待の数。本人は変えられない（input: false）。増やすときは DB を直接更新する。
        inviteLimit: {
          type: "number",
          required: false,
          defaultValue: DEFAULT_INVITE_LIMIT,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        update: {
          // 名前は前後の空白を除いて保存する。color は style に埋め込まれるので、形式が正しいものだけ保存する。
          // 画像（image）はここでは設定できない（routes/api/avatar.ts だけが設定する）
          before: async (data) => {
            const validated = await valueOrThrowAPIError(
              container().memberUsecase.validateProfileUpdate(data),
            );
            return { data: { ...data, ...validated } };
          },
        },
        create: {
          // 招待がないと新規ユーザーは作れない。入力が正しくないときに招待を無駄にしないよう、先に確かめる
          before: async (user, ctx) => {
            // 登録時のメールアドレスは、ブラウザ（pages/login.svelte）が作る使い捨ての <UUID>@nwu.invalid だけ
            const validated = await valueOrThrowAPIError(
              container().memberUsecase.validateSignUp(user),
            );
            const data = { ...user, ...validated };
            // 同じトークンで同時に登録されても、成功するのは 1 回だけ。理由は教えずに同じエラーにする
            await valueOrThrowAPIError(
              container().memberUsecase.claimInvite({
                token: readInviteCookie(ctx?.request),
              }),
            );
            return { data };
          },
          after: async (user, ctx) => {
            await valueOrThrowAPIError(
              container().memberUsecase.linkInvitedUser({
                token: readInviteCookie(ctx?.request),
                userId: user.id,
              }),
            );
            // 使い終わった招待の Cookie は消す
            ctx?.setCookie(INVITE_COOKIE, "", { path: "/", maxAge: 0 });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // 外部のアプリ（MCP のクライアント）への許可は、ログインし直したばかりのセッションだけが行える。
        // 拒否するときは accept: false でも同じエラーにする（同意画面は、パスキーでログインし直すよう案内する）
        if (ctx.path === "/oauth2/consent") {
          const session = await getSessionFromCtx(ctx);
          if (!session) return; // 未ログイン時はエンドポイント側の認証で弾かれる
          await valueOrThrowAPIError(
            container().memberUsecase.checkOAuthConsent({
              sessionCreatedAt: new Date(session.session.createdAt),
            }),
          );
          return;
        }
        if (ctx.path !== "/passkey/delete-passkey") return;
        // 最後のパスキーを削除するとログインできなくなるため、サーバー側でも拒否する。
        // パスキーの追加（better-auth の freshSessionMiddleware）と同じく、ログインし直したばかりのセッションだけが削除できる
        const session = await getSessionFromCtx(ctx);
        if (!session) return; // 未ログイン時はエンドポイント側の認証で弾かれる
        const passkeyCount = await ctx.context.adapter.count({
          model: "passkey",
          where: [{ field: "userId", value: session.user.id }],
        });
        await valueOrThrowAPIError(
          container().memberUsecase.checkPasskeyDeletion({
            sessionCreatedAt: new Date(session.session.createdAt),
            passkeyCount,
          }),
        );
      }),
    },
    plugins: [
      ...(defaults.plugins ?? []),
      // 登録後（ユーザー作成・ログインした後）に、パスキーを追加する
      passkey({ rpName: "NWU" }),
      // OAuth のアクセストークン（JWT）の署名。鍵は DB（jwks）に暗号化して保存される（暗号化は外さない）
      jwt({
        jwt: { issuer: oauthIssuer(origin) },
        // ログイン中のセッションに JWT を付けない（使わないので、作らない）
        disableSettingJwtHeader: true,
      }),
      // MCP（/api/mcp）のための OAuth 2.1 の認可サーバー。設計は docs/design/mcp.md
      oauthProvider({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        scopes: OAUTH_SCOPES,
        // 認可コード（PKCE 必須）とリフレッシュだけ。client_credentials は使わない
        grantTypes: ["authorization_code", "refresh_token"],
        // トークンの宛先（aud）は /api/mcp だけ
        resources: [resource],
        clientRegistrationDefaultResources: [resource],
        // MCP のクライアントは自分で登録する（DCR）。登録できるスコープは MCP のものだけ
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: OAUTH_SCOPES,
        clientRegistrationAllowedScopes: OAUTH_SCOPES,
        clientRegistrationRequirePKCE: true,
        // application_type を送らないネイティブのクライアント（ループバックのコールバック）も登録できるように
        clientRegistrationDefaultApplicationType: "infer",
        // 登録どおりで、さらに使うクライアントのホストかループバックへだけ返す（server/mcp/redirect.ts）
        validateRedirectUri: (uri, _registered, defaultResult) =>
          defaultResult && isAllowedRedirectUri(uri),
        // アクセストークン 1 時間、リフレッシュトークン 30 日（使うたびに作り直す）
        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 30 * 24 * 60 * 60,
        // ホームの New を決める登録日時を、トークンに入れておく（/api/mcp で DB を引かないため）
        customAccessTokenClaims: ({ user }) =>
          user ? { joined_at: new Date(user.createdAt).toISOString() } : {},
        advertisedMetadata: { scopes_supported: [...MCP_SCOPES] },
      }),
    ],
  };
});
