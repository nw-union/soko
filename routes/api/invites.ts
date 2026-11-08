import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../server/container.ts";
import { errorResponse } from "../../server/http.ts";

// 自分が発行した招待の一覧と、あと何回発行できるか
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c);
  return container()
    .memberWorkFlows.listInvites({ userId: user.id })
    .match(
      (evt) => evt,
      (e) => errorResponse(c, e),
    );
});

// 招待を発行する。トークンはこのレスポンスで 1 回だけ返す（DB にはハッシュしか残らない）。上限に達していれば 409
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  return container()
    .memberWorkFlows.issueInvite({ userId: user.id })
    .match(
      (evt) => evt,
      (e) => errorResponse(c, e),
    );
});

// 未使用の招待を取り消す（枠が戻る）
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  return container()
    .memberWorkFlows.revokeInvite({ userId: user.id, id: c.req.query("id") })
    .match(
      () => null,
      (e) => errorResponse(c, e),
    );
});
