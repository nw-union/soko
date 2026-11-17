import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { container } from "../../../server/container.ts";
import { respond } from "../../../server/http/error.ts";

// デバッグ画面 (pages/debug.svelte) 用: 同期の対象のプレイリストの一覧
export const GET = defineHandler(async (c) => {
  requireAuth(c);
  return respond(c, container().contentUsecase.listPlaylists(), (evt) => evt);
});

// プレイリストを足す. 本文は { playlistId }
export const POST = defineHandler(async (c) => {
  requireAuth(c);
  const body = (await c.req.json().catch(() => null)) as {
    playlistId?: unknown;
  } | null;
  return respond(
    c,
    container().contentUsecase.createPlaylist({
      // 文字列でなければ空にする (形式の検証はドメインで行う)
      playlistId: typeof body?.playlistId === "string" ? body.playlistId : "",
    }),
    (evt) => evt,
  );
});
