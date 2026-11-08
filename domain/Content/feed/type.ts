import type { UserId } from "../../vo.ts";

/**
 * 保存されている動画 (DB の値のまま. youtubeId はまだ検証していない)
 */
export interface StoredVideo {
  readonly type: "StoredVideo";
  readonly id: number;
  readonly youtubeId: string;
  readonly title: string;
  readonly description: string | null;
  readonly durationSeconds: number | null;
  readonly aspectRatio: number | null;
  // ISO 8601. わからなければ null
  readonly publishedAt: string | null;
  // 概要欄のハッシュタグ (# なし)
  readonly tags: readonly string[];
}

/**
 * プレイリストと, それに入っている動画の組
 */
export interface PlaylistVideo {
  readonly playlistId: number;
  readonly video: StoredVideo;
}

export interface Playlist {
  readonly type: "Playlist";
  readonly id: number;
  readonly name: string;
  readonly description: string;
}

/**
 * New の判定に使う, 動画の投稿日時
 */
export interface VideoDate {
  readonly youtubeId: string;
  readonly publishedAt: string | null;
}

/**
 * New の判定に使う, ユーザーの登録日時
 */
export interface Member {
  readonly id: UserId;
  readonly joinedAt: Date;
}

export interface Watch {
  readonly userId: string;
  readonly youtubeId: string;
}
