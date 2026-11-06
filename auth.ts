import { passkey } from "@better-auth/passkey";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { defineAuth } from "void/auth";
import { DEFAULT_INVITE_LIMIT } from "./domain/Invite/logic.ts";
import { FRESH_AGE_SECONDS } from "./domain/Profile/logic.ts";
import type { AppError } from "./error.ts";
import { container } from "./server/container.ts";
import { INVITE_COOKIE, readInviteCookie } from "./server/invite-cookie.ts";

// プロフィール（名前・イメージカラー・アイコン）と招待のルールは domain/ にある。ここは better-auth とつなぐだけ

// ---- 招待トークン ----
// 新規登録は、メンバーが発行した招待（invites テーブル）のトークンを持っている人だけができる。
// トークンは /api/invite/start で検証され、短命の Cookie に入る。その後の sign-up でユーザーを作る。
// ユーザー作成の直前（databaseHooks.user.create.before）で Cookie のトークンを使用済みにする。

// WorkFlow のエラーを better-auth のエラーにする。入力の誤りと権限の不足は、理由をそのまま返す
const toAPIError = (e: AppError) => {
  switch (e.type) {
    case "ValidationError":
      return new APIError("BAD_REQUEST", {
        message: Object.values(e.issues)[0]?.[0] ?? e.message,
      });
    case "ForbiddenError":
      return new APIError("FORBIDDEN", { message: e.message, code: e.code });
    default:
      return new Error(`${e.type}: ${e.message}`, {
        cause: "cause" in e ? e.cause : undefined,
      });
  }
};

export default defineAuth(({ defaults }) => {
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
    session: { ...defaults.session, freshAge: FRESH_AGE_SECONDS },
    // イメージカラー（#rrggbb）。プロフィールで本人が変更できる
    user: {
      // プロフィール画面からアカウントを削除できる（HIG: 作れるなら削除もできるように）。
      // 削除の直前に、画面側でパスキーを使って本人確認し直す（セッションを新しくする）。
      // パスキー・セッションは user に連動して消える。発行した未使用の招待と、通知の購読、視聴記録もここで消す（使用済みの招待の記録は残す）
      deleteUser: {
        enabled: true,
        afterDelete: async (user) => {
          const cleaned = await container().profileWorkFlows.cleanupDeletedUser(
            { userId: user.id, image: user.image },
          );
          if (cleaned.isErr()) throw toAPIError(cleaned.error);
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
            const validated =
              await container().profileWorkFlows.validateProfileUpdate(data);
            if (validated.isErr()) throw toAPIError(validated.error);
            return { data: { ...data, ...validated.value } };
          },
        },
        create: {
          // 招待がないと新規ユーザーは作れない。入力が正しくないときに招待を無駄にしないよう、先に確かめる
          before: async (user, ctx) => {
            // 登録時のメールアドレスは、ブラウザ（pages/login.svelte）が作る使い捨ての <UUID>@nwu.invalid だけ
            const validated =
              await container().profileWorkFlows.validateSignUp(user);
            if (validated.isErr()) throw toAPIError(validated.error);
            const data = { ...user, ...validated.value };
            // 同じトークンで同時に登録されても、成功するのは 1 回だけ。理由は教えずに同じエラーにする
            const claimed = await container().inviteWorkFlows.claimInvite({
              token: readInviteCookie(ctx?.request),
            });
            if (claimed.isErr()) throw toAPIError(claimed.error);
            return { data };
          },
          after: async (user, ctx) => {
            const linked = await container().inviteWorkFlows.linkInvitedUser({
              token: readInviteCookie(ctx?.request),
              userId: user.id,
            });
            if (linked.isErr()) throw toAPIError(linked.error);
            // 使い終わった招待の Cookie は消す
            ctx?.setCookie(INVITE_COOKIE, "", { path: "/", maxAge: 0 });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/passkey/delete-passkey") return;
        // 最後のパスキーを削除するとログインできなくなるため、サーバー側でも拒否する。
        // パスキーの追加（better-auth の freshSessionMiddleware）と同じく、ログインし直したばかりのセッションだけが削除できる
        const session = await getSessionFromCtx(ctx);
        if (!session) return; // 未ログイン時はエンドポイント側の認証で弾かれる
        const passkeyCount = await ctx.context.adapter.count({
          model: "passkey",
          where: [{ field: "userId", value: session.user.id }],
        });
        const checked = await container().profileWorkFlows.checkPasskeyDeletion(
          {
            sessionCreatedAt: new Date(session.session.createdAt),
            passkeyCount,
          },
        );
        if (checked.isErr()) throw toAPIError(checked.error);
      }),
    },
    plugins: [
      ...(defaults.plugins ?? []),
      // 登録後（ユーザー作成・ログインした後）に、パスキーを追加する
      passkey({ rpName: "NWU" }),
    ],
  };
});
