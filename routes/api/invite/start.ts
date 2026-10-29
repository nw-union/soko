import { setCookie } from "hono/cookie";
import { defineHandler } from "void";
import { db, sql } from "void/db";
import {
  hashToken,
  INVITE_COOKIE,
  normalizeToken,
  TOKEN_LENGTH,
} from "../../../src/lib/invite";

// 登録の入口。招待トークンが使えるか確かめて、使えるなら短命の Cookie に入れる。
// この後の sign-up でユーザーが作られるときに、auth.ts がこの Cookie の招待を使用済みにする
export const POST = defineHandler(async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const token = normalizeToken(
    typeof body?.token === "string" ? body.token : "",
  );
  const invalid = () =>
    c.json({ message: "招待コードが正しくないか、期限切れです" }, 400);
  if (token.length !== TOKEN_LENGTH) return invalid();

  const rows = await db.all<{ id: number }>(sql`
    SELECT id FROM invites
    WHERE token_hash = ${await hashToken(token)}
      AND used_at IS NULL
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    LIMIT 1`);
  if (!rows[0]) return invalid();

  setCookie(c, INVITE_COOKIE, token, {
    httpOnly: true,
    secure: c.req.url.startsWith("https:"),
    sameSite: "Lax",
    path: "/",
    maxAge: 15 * 60,
  });
  // null を返すと Set-Cookie が落ちるので、本文のある応答にする
  return c.json({ ok: true });
});
