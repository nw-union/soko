import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../server/container.ts";
import { respond } from "../../server/http/error.ts";

// 自分が発行した招待の一覧と、あと何回発行できるか
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c);
  return respond(
    c,
    container().memberUsecase.listInvites({ userId: user.id }),
    (evt) => evt,
  );
});

// 招待を発行する。トークンはこのレスポンスで 1 回だけ返す（DB にはハッシュしか残らない）。上限に達していれば 409
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  return respond(
    c,
    container().memberUsecase.invite({ userId: user.id }),
    (evt) => evt,
  );
});

// 未使用の招待を取り消す（枠が戻る）
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  return respond(
    c,
    container().memberUsecase.revokeInvite({
      userId: user.id,
      id: c.req.query("id"),
    }),
    () => null,
  );
});
