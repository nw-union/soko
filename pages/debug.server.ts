import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { container } from "../server/container.ts";
import { throwError } from "../server/http.ts";

export type Props = InferProps<typeof loader>;

// 動画の同期とプレイリストの管理を手で行うデバッグ用の画面. ログインしている人だけが入れる
export const loader = defineHandler(async (c) => {
  if (!getUser()) return c.redirect("/login");
  return container()
    .contentQueries.listPlaylists()
    .match((evt) => evt, throwError);
});

export const head = defineHead(() => ({ title: "Debug | Soko" }));
