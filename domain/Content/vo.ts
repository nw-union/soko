import * as v from "valibot";
import { newVo } from "../shared/vo.ts";

/**
 * PlaylistId YouTube のプレイリスト ID (list= の後ろ. PL…・UU…・OLAK5uy_… など)
 *
 * YouTube Data API のクエリに入れるので, 英数字と - _ だけにする
 */
const playlistId = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{10,64}$/),
  v.brand("PlaylistId"),
);
export type PlaylistId = v.InferOutput<typeof playlistId>;
export const newPlaylistId = newVo(playlistId, "PlaylistId");

/**
 * PlaylistRowId playlists テーブルの ID (YouTube のプレイリスト ID とは別)
 */
const playlistRowId = v.pipe(
  v.number(),
  v.safeInteger(),
  v.minValue(1),
  v.brand("PlaylistRowId"),
);
export type PlaylistRowId = v.InferOutput<typeof playlistRowId>;
export const newPlaylistRowId = newVo(playlistRowId, "PlaylistRowId");
