import { passkey } from "@better-auth/passkey";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { defineAuth } from "void/auth";
import { db, sql } from "void/db";

// src/lib/color.ts の isHexColor と同じ判定。auth.ts は Void の CLI からも読み込まれ、
// 拡張子なしの相対 import を解決できないため、ここでは import せずに持つ
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// src/lib/profile.ts の NAME_MAX と同じにすること
const NAME_MAX = 30;
// 登録時のメールアドレスは、ブラウザ（pages/login.svelte）が作る使い捨ての <UUID>@nwu.invalid だけ
const SIGNUP_EMAIL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@nwu\.invalid$/;
// ログイン（登録）から何秒までのセッションを「新しい」とみなすか。登録直後の /welcome でのパスキー作成もこの時間内に行う
const FRESH_AGE_SECONDS = 10 * 60;

// 登録・更新で本人が送ってくる名前とイメージカラーを確かめ、名前は前後の空白を除いて返す。
// color は style に埋め込まれるので、形式が正しいものだけ保存する。画像（image）はまだ設定できない
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
// DB には SHA-256 のハッシュだけが入っている。
// ここの normalizeToken / hashToken と INVITE_COOKIE は src/lib/invite.ts・scripts/create-invite.mjs と同じにすること。
const INVALID_INVITE = "招待コードが正しくないか、期限切れです";
const TOKEN_LENGTH = 16;
const INVITE_COOKIE = "nwu_invite";

// 大文字小文字・ハイフン・空白の違いは無視する（スマホで打ち間違えにくいように）
const normalizeToken = (raw: string) =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readCookie(request: Request | undefined, name: string): string | null {
  const header = request?.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// 未使用で期限内の招待を使用済みにして、そのトークンのハッシュを返す。
// 同じトークンで同時に登録されても、成功するのは 1 回だけ。理由は教えずに同じエラーにする
async function claimInvite(request: Request | undefined): Promise<string> {
  const token = normalizeToken(readCookie(request, INVITE_COOKIE) ?? "");
  if (token.length !== TOKEN_LENGTH)
    throw new APIError("BAD_REQUEST", { message: INVALID_INVITE });
  const tokenHash = await hashToken(token);
  const claimed = await db.run(sql`
    UPDATE invites SET used_at = datetime('now')
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
      AND (expires_at IS NULL OR expires_at > datetime('now'))`);
  if (!claimed.meta?.changes)
    throw new APIError("BAD_REQUEST", { message: INVALID_INVITE });
  return tokenHash;
}

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
        // 初期値は src/lib/invite.ts の DEFAULT_INVITE_LIMIT と同じにすること
        inviteLimit: {
          type: "number",
          required: false,
          defaultValue: 3,
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
            await claimInvite(ctx?.request);
            return { data };
          },
          after: async (user, ctx) => {
            const token = normalizeToken(
              readCookie(ctx?.request, INVITE_COOKIE) ?? "",
            );
            await db.run(
              sql`UPDATE invites SET used_by_user_id = ${user.id} WHERE token_hash = ${await hashToken(token)}`,
            );
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
