import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { container } from "../server/container.ts";
import { throwError } from "../server/http/error.ts";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  // 限定公開の動画も並ぶので、ミドルウェアだけに頼らずここでもログインを確かめる
  const user = getUser();
  if (!user) return c.redirect("/login");
  return container()
    .contentQueries.getHomeFeed({ userId: user.id, joinedAt: user.createdAt })
    .match((evt) => evt, throwError);
});

export const head = defineHead(() => ({ title: "Soko" }));
