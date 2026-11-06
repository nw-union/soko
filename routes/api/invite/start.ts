import { setCookie } from "hono/cookie";
import { defineHandler } from "void";
import { container } from "../../../server/container.ts";
import { errorResponse } from "../../../server/http.ts";
import {
  INVITE_COOKIE,
  INVITE_COOKIE_MAX_AGE,
} from "../../../server/invite-cookie.ts";

// 登録の入口。招待トークンが使えるか確かめて、使えるなら短命の Cookie に入れる。
// この後の sign-up でユーザーが作られるときに、auth.ts がこの Cookie の招待を使用済みにする
export const POST = defineHandler(async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return container()
    .inviteWorkFlows.startInvite({ token: body?.token })
    .match(
      ({ token }) => {
        setCookie(c, INVITE_COOKIE, token, {
          httpOnly: true,
          secure: c.req.url.startsWith("https:"),
          sameSite: "Lax",
          path: "/",
          maxAge: INVITE_COOKIE_MAX_AGE,
        });
        // null を返すと Set-Cookie が落ちるので、本文のある応答にする
        return c.json({ ok: true });
      },
      (e) => errorResponse(c, e),
    );
});
