import { defineHandler } from "void";
import { getUser } from "void/auth";

export const loader = defineHandler((c) => {
  // ログイン済みならアプリ（/）へ
  if (getUser()) return c.redirect("/");
  return {};
});
