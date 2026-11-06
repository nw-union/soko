import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../server/container.ts";
import { errorResponse } from "../../server/http.ts";

// 動画を見たことを記録する。再生が始まったとき・YouTube で開いたときに、ブラウザ（pages/index.svelte）が送る。
// 登録済みの動画だけを受け付け、同じ動画を何度送っても 1 行のまま（最初に見た日時が残る）
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const body = (await c.req.json().catch(() => null)) as {
    youtubeId?: unknown;
  } | null;
  return container()
    .feedWorkFlows.recordWatch({ userId: user.id, youtubeId: body?.youtubeId })
    .match(
      () => null,
      (e) => errorResponse(c, e),
    );
});

// 視聴記録を消して、未視聴に戻す
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  return container()
    .feedWorkFlows.unrecordWatch({
      userId: user.id,
      youtubeId: c.req.query("youtubeId"),
    })
    .match(
      () => null,
      (e) => errorResponse(c, e),
    );
});
