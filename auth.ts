import { passkey } from "@better-auth/passkey";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { defineAuth } from "void/auth";
import { db, sql } from "void/db";
import { storage } from "void/storage";
import type { AppError } from "./error.ts";
import { DEFAULT_INVITE_LIMIT } from "./domain/Invite/logic.ts";
import { container } from "./server/container.ts";
import { INVITE_COOKIE, readInviteCookie } from "./server/invite-cookie.ts";

// src/lib/color.ts の isHexColor と同じ判定。auth.ts は Void の CLI からも読み込まれ、
// 拡張子なしの相対 import を解決できないため、ここでは import せずに持つ
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// src/lib/profile.ts の NAME_MAX と同じにすること
const NAME_MAX = 30;
// src/lib/avatar.ts の AVATAR_PREFIX・キーの形式と同じにすること（アカウント削除時にアイコン画像を R2 から消す）
const AVATAR_PATH = /^\/files\/avatars\/([0-9a-f]{32}\.(?:jpg|png|webp))$/;
// 登録時のメールアドレスは、ブラウザ（pages/login.svelte）が作る使い捨ての <UUID>@nwu.invalid だけ
const SIGNUP_EMAIL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@nwu\.invalid$/;
// ログイン（登録）から何秒までのセッションを「新しい」とみなすか。登録直後の /welcome でのパスキー作成もこの時間内に行う
const FRESH_AGE_SECONDS = 10 * 60;

// 登録・更新で本人が送ってくる名前とイメージカラーを確かめ、名前は前後の空白を除いて返す。
// color は style に埋め込まれるので、形式が正しいものだけ保存する。画像（image）はここでは設定できない（routes/api/avatar.ts だけが設定する）
function validateProfile<T extends Record<string, unknown>>(data: T): T {
  const { name, color, image } = data;
  if (
    name !== undefined &&
    (typeof name !== "string" || !name.trim() || name.trim().length > NAME_MAX)
  ) {
    throw new APIError("BAD_REQUEST", {
      message: `名前は 1〜${NAME_MAX} 文字で入力してください`,
    });
  }
  if (
    color !== undefined &&
    color !== null &&
    (typeof color !== "string" || !HEX_COLOR.test(color))
  ) {
    throw new APIError("BAD_REQUEST", {
      message: "カラーコードは #rrggbb の形式で入力してください",
    });
  }
  if (image !== undefined && image !== null) {
    throw new APIError("BAD_REQUEST", { message: "画像は設定できません" });
  }
  return typeof name === "string" ? { ...data, name: name.trim() } : data;
}

// ---- 招待トークン ----
// 新規登録は、メンバーが発行した招待（invites テーブル）のトークンを持っている人だけができる。
// トークンは /api/invite/start で検証され、短命の Cookie に入る。その後の sign-up でユーザーを作る。
// ユーザー作成の直前（databaseHooks.user.create.before）で Cookie のトークンを使用済みにする。
// 招待のルールは domain/Invite にある

// WorkFlow のエラーを better-auth のエラーにする。入力の誤り（使えない招待など）だけは、理由をそのまま返す
const toAPIError = (e: AppError) =>
  e.type === "ValidationError"
    ? new APIError("BAD_REQUEST", {
        message: Object.values(e.issues)[0]?.[0] ?? e.message,
      })
    : new Error(`${e.type}: ${e.message}`, {
        cause: "cause" in e ? e.cause : undefined,
      });

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
          const avatar = user.image && AVATAR_PATH.exec(user.image);
          if (avatar)
            await storage.delete(`avatars/${avatar[1]}`).catch(() => {});
          await db.run(
            sql`DELETE FROM invites WHERE inviter_user_id = ${user.id} AND used_at IS NULL`,
          );
          await db.run(
            sql`DELETE FROM push_subscriptions WHERE user_id = ${user.id}`,
          );
          await db.run(
            sql`DELETE FROM video_watches WHERE user_id = ${user.id}`,
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
          before: async (data) => ({ data: validateProfile(data) }),
        },
        create: {
          // 招待がないと新規ユーザーは作れない。入力が正しくないときに招待を無駄にしないよう、先に確かめる
          before: async (user, ctx) => {
            if (!SIGNUP_EMAIL.test(user.email))
              throw new APIError("BAD_REQUEST", { message: "登録できません" });
            const data = validateProfile(user);
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
        // 最後のパスキーを削除するとログインできなくなるため、サーバー側でも拒否する
        const session = await getSessionFromCtx(ctx);
        if (!session) return; // 未ログイン時はエンドポイント側の認証で弾かれる
        // パスキーの追加（better-auth の freshSessionMiddleware）と同じく、ログインし直したばかりのセッションだけが削除できる
        const age = Date.now() - new Date(session.session.createdAt).getTime();
        if (age >= FRESH_AGE_SECONDS * 1000) {
          throw new APIError("FORBIDDEN", {
            message: "Session is not fresh",
            code: "SESSION_NOT_FRESH",
          });
        }
        const count = await ctx.context.adapter.count({
          model: "passkey",
          where: [{ field: "userId", value: session.user.id }],
        });
        if (count <= 1) {
          throw new APIError("BAD_REQUEST", {
            message:
              "最後のパスキーは削除できません（ログインできなくなります）",
          });
        }
      }),
    },
    plugins: [
      ...(defaults.plugins ?? []),
      // 登録後（ユーザー作成・ログインした後）に、パスキーを追加する
      passkey({ rpName: "NWU" }),
    ],
  };
});
