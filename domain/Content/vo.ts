import { type InferVo, v } from "@nw-union/nw-utils/lib/vo";
import { newVo, safeInteger } from "../shared/vo.ts";

/**
 * PlaylistId YouTube のプレイリスト ID (list= の後ろ. PL…・UU…・OLAK5uy_… など)
 *
 * YouTube Data API のクエリに入れるので, 英数字と - _ だけにする
 */
export const newPlaylistId = newVo(
  "PlaylistId",
  v.chain(v.string, v.regex(/^[A-Za-z0-9_-]{10,64}$/)),
);
export type PlaylistId = InferVo<typeof newPlaylistId>;

/**
 * PlaylistRowId playlists テーブルの ID (YouTube のプレイリスト ID とは別)
 */
export const newPlaylistRowId = newVo(
  "PlaylistRowId",
  v.chain(v.number, safeInteger, v.minValue(1)),
);
export type PlaylistRowId = InferVo<typeof newPlaylistRowId>;
