import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";

export type Props = InferProps<typeof loader>;

// 登録した直後の画面。ログインしている人だけが入れる
export const loader = defineHandler(async (c) => {
  if (!getUser()) return c.redirect("/login");
  return {};
});

export const head = defineHead(() => ({ title: "Welcome | NWU" }));
