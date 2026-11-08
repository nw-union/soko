import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../../server/container.ts";
import { errorResponse } from "../../../server/http.ts";

// デバッグ画面 (pages/debug.svelte) 用: 同期の対象のプレイリストの一覧
export const GET = defineHandler(async (c) => {
  requireAuth(c);
  return container()
    .contentWorkFlows.listPlaylists()
    .match(
      (evt) => evt,
      (e) => errorResponse(c, e),
    );
});

// プレイリストを足す. 本文は { playlistId }
export const POST = defineHandler(async (c) => {
  requireAuth(c);
  const body = (await c.req.json().catch(() => null)) as {
    playlistId?: unknown;
  } | null;
  return container()
    .contentWorkFlows.createPlaylist({ playlistId: body?.playlistId })
    .match(
      (dto) => dto,
      (e) => errorResponse(c, e),
    );
});
