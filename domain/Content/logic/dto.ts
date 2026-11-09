// Domain Type -> DTO の変換（画面に出す形にする）
import {
  embedUrl,
  formatDuration,
  thumbnailUrl,
  watchUrl,
} from "../../rule/youtube.ts";
import type { PlaylistSettingDto, VideoItemDto } from "../api.ts";
import type { Playlist, StoredVideo } from "../type.ts";

// ----------------------------------------------------------------------------
// Converter (Domain Type -> DTO)
// ----------------------------------------------------------------------------
// 投稿日時は日本時間の 2026.10.29 の形にする
const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * 投稿日時を画面に出す形にする. 日時のない (読めない) 動画は null
 */
export const formatPublishedAt = (iso: string | null): string | null => {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? dateFormat.format(date).replaceAll("/", ".")
    : null;
};

/**
 * 動画を画面に渡す形にする
 */
export const convToVideoItemDto = (
  video: StoredVideo,
  watched: boolean,
): VideoItemDto => ({
  id: video.id,
  youtubeId: video.youtubeId,
  title: video.title,
  description: video.description ?? "",
  duration: video.durationSeconds
    ? formatDuration(video.durationSeconds)
    : null,
  aspectRatio: video.aspectRatio ?? 16 / 9,
  publishedAt: formatPublishedAt(video.publishedAt),
  tags: [...video.tags],
  watched,
  url: watchUrl(video.youtubeId),
  embed: embedUrl(video.youtubeId),
  thumbnail: thumbnailUrl(video.youtubeId),
});

/**
 * 管理画面に出すプレイリスト
 */
export const convToPlaylistSettingDto = (
  list: Playlist,
): PlaylistSettingDto => ({
  id: list.id,
  playlistId: list.playlistId,
  name: list.name,
});
