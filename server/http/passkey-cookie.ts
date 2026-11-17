// パスキーを作ったことを覚えておく、署名つきの Cookie。middleware/01.auth.ts が、ページを開くたびに DB でパスキーを数えないために使う。
// 最後のパスキーは消せない（auth.ts）ので、一度作ればアカウントがある限りパスキーはなくならない。そのため「ある」ことだけを覚える。
// 値はユーザー ID なので、別のアカウントでログインし直したら使われない。署名の鍵がないとき（ローカル）は、何もしない
import type { Context } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";

const PASSKEY_COOKIE = "nwu_passkey";
const PASSKEY_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

// better-auth の署名と同じ鍵を使うので、ほかの用途の値と取り違えないよう、前に用途を付ける
const valueFor = (userId: string) => `passkey:${userId}`;

export const readPasskeyCookie = async (
  c: Context,
  secret: string | undefined,
  userId: string,
): Promise<boolean> =>
  !!secret &&
  (await getSignedCookie(c, secret, PASSKEY_COOKIE)) === valueFor(userId);

export const writePasskeyCookie = async (
  c: Context,
  secret: string | undefined,
  userId: string,
): Promise<void> => {
  if (!secret) return;
  await setSignedCookie(c, PASSKEY_COOKIE, valueFor(userId), secret, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: PASSKEY_COOKIE_MAX_AGE,
  });
};
