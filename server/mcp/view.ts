// MCP に返す形。画面用の DTO から、LLM に要らないもの（埋め込みの URL・サムネイル・縦横比など）を落とし、件数に上限を付ける。
// 外部の AI に渡すデータを必要な分に絞るためでもある
import type { HomeFeedView, VideoItemDto } from "../../domain/Content/api.ts";

/** 1 つの一覧で返す動画の数の上限 */
export const MAX_VIDEOS_PER_LIST = 50;

export type McpVideo = {
  youtubeId: string;
  title: string;
  duration: string | null;
  publishedAt: string | null;
  tags: string[];
  watched: boolean;
  url: string;
};

export const toMcpVideo = (v: VideoItemDto): McpVideo => ({
  youtubeId: v.youtubeId,
  title: v.title,
  duration: v.duration,
  publishedAt: v.publishedAt,
  tags: v.tags,
  watched: v.watched,
  url: v.url,
});

const limited = (videos: VideoItemDto[]) => ({
  videos: videos.slice(0, MAX_VIDEOS_PER_LIST).map(toMcpVideo),
  total: videos.length,
});

/** ホーム: New の候補と、プレイリストごとの動画（新しい順） */
export const toMcpHomeFeed = (view: HomeFeedView) => {
  const newVideos = limited(view.newVideos);
  return {
    newVideos: newVideos.videos,
    newVideosTotal: newVideos.total,
    playlists: view.playlists.map((p) => {
      const l = limited(p.videos);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        videos: l.videos,
        videosTotal: l.total,
      };
    }),
  };
};
