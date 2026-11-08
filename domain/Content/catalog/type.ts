/**
 * 同期するプレイリスト (playlists テーブル)
 */
export interface SyncPlaylist {
  // DB の ID
  readonly id: number;
  // YouTube のプレイリスト ID (PL…)
  readonly playlistId: string;
  readonly name: string;
  readonly description: string;
}

/**
 * YouTube のプレイリストのタイトルと説明
 */
export interface PlaylistInfo {
  readonly title: string;
  readonly description: string;
}

/**
 * YouTube Data API の videos.list の 1 件 (使う項目だけ. 値は API のまま)
 */
export interface YoutubeVideoItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly publishedAt: string;
  // "live" (ライブ中)・"upcoming" (配信予定・プレミア公開待ち)・"none" (通常の動画, 配信が終わった動画)
  readonly liveBroadcastContent: string;
  // ISO 8601 の期間 ("PT1H2M3S")
  readonly duration: string;
  // 埋め込みの iframe のタグ. 幅と高さが動画の縦横比に合っている
  readonly embedHtml: string | undefined;
  readonly privacyStatus: string;
  readonly embeddable: boolean;
}

/**
 * 表示対象として取り込む動画
 */
export interface FetchedVideo {
  readonly youtubeId: string;
  readonly title: string;
  readonly description: string;
  // ライブ中・配信予定のように, 長さがまだない動画は null
  readonly durationSeconds: number | null;
  // 動画の縦横比 (幅 ÷ 高さ). わからなければ null (16:9 として扱う)
  readonly aspectRatio: number | null;
  readonly publishedAt: string;
  // 概要欄のハッシュタグ (# なし)
  readonly tags: readonly string[];
}

/**
 * 保存されている動画の, DB の ID と YouTube の ID
 */
export interface StoredVideoId {
  readonly id: number;
  readonly youtubeId: string;
}

/**
 * プレイリストと動画の紐付け (playlist_videos)
 */
export interface Link {
  readonly playlistId: number;
  readonly videoId: number;
  // プレイリスト内での並び (YouTube 上の順, 0 始まり)
  readonly position: number;
}

/**
 * プレイリストから外す紐付け
 */
export interface StaleLinks {
  readonly playlistId: number;
  readonly videoIds: readonly number[];
}
