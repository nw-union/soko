import { z } from "zod";
import { newVo } from "../vo.ts";

/**
 * PlaylistId YouTube のプレイリスト ID (list= の後ろ. PL…・UU…・OLAK5uy_… など)
 *
 * YouTube Data API のクエリに入れるので, 英数字と - _ だけにする
 */
const playlistId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,64}$/)
  .brand("PlaylistId");
export type PlaylistId = z.infer<typeof playlistId>;
export const newPlaylistId = newVo(playlistId, "PlaylistId");

/**
 * PlaylistRowId playlists テーブルの ID (YouTube のプレイリスト ID とは別)
 */
const playlistRowId = z.number().int().positive().brand("PlaylistRowId");
export type PlaylistRowId = z.infer<typeof playlistRowId>;
export const newPlaylistRowId = newVo(playlistRowId, "PlaylistRowId");
