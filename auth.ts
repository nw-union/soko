import { passkey } from "@better-auth/passkey";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { defineAuth } from "void/auth";
import { db, sql } from "void/db";

// src/lib/color.ts の isHexColor と同じ判定。auth.ts は Void の CLI からも読み込まれ、
// 拡張子なしの相対 import を解決できないため、ここでは import せずに持つ
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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
const normalizeToken = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  if (token.length !== TOKEN_LENGTH) throw new APIError("BAD_REQUEST", { message: INVALID_INVITE });
  const tokenHash = await hashToken(token);
  const claimed = await db.run(sql`
    UPDATE invites SET used_at = datetime('now')
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
      AND (expires_at IS NULL OR expires_at > datetime('now'))`);
  if (!claimed.meta?.changes) throw new APIError("BAD_REQUEST", { message: INVALID_INVITE });
  return tokenHash;
}

export default defineAuth(({ defaults }) => {
  return {
  ...defaults,
  // ログインはパスキーだけ。メール + パスワードは、招待コードでの登録時にユーザーを作るためだけに使う
  // （パスワードはブラウザが捨てるランダムな値で、誰も知らない）
  emailAndPassword: { enabled: true },
  databaseHooks: {
    user: {
      create: {
        // 招待がないと新規ユーザーは作れない
        before: async (_user, ctx) => {
          await claimInvite(ctx?.request);
        },
        after: async (user, ctx) => {
          const token = normalizeToken(readCookie(ctx?.request, INVITE_COOKIE) ?? "");
          await db.run(
            sql`UPDATE invites SET used_by_user_id = ${user.id} WHERE token_hash = ${await hashToken(token)}`,
          );
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
      const count = await ctx.context.adapter.count({
        model: "passkey",
        where: [{ field: "userId", value: session.user.id }],
      });
      if (count <= 1) {
        throw new APIError("BAD_REQUEST", { message: "最後のパスキーは削除できません（ログインできなくなります）" });
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
