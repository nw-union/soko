import { defineHandler, type InferProps } from "void";
import { getUser } from "void/auth";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler((c) => {
  // ログイン済みならアプリ（/）へ。ただし外部のアプリの認可の途中（署名付きのクエリがある。prompt=login など）は、ログインし直してもらう
  if (getUser() && !c.req.query("sig")) return c.redirect("/");
  // 招待リンクなら、登録の欄を最初から開いて出す。画面の表示後に開くと、がたつくのでここで判断する
  return { hasInvite: Boolean(c.req.query("invite")) };
});
