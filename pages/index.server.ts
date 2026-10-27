import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { asc, db, desc, eq } from "void/db";
import { playlists, playlistVideos, videos } from "@schema";
import { embedUrl, formatDuration, isYoutubeId, thumbnailUrl, watchUrl } from "../src/lib/youtube";

// プレイリストごとに表示する、最新の動画の数
const LATEST_COUNT = 5;

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  // 限定公開の動画も並ぶので、ミドルウェアだけに頼らずここでもログインを確かめる
  if (!getUser()) return c.redirect("/login");
  const lists = await db.select().from(playlists).orderBy(asc(playlists.position), asc(playlists.id));
  // プレイリストと動画の組。投稿日時の新しい順（日時のない動画は最後）
  const rows = await db
    .select({ playlistId: playlistVideos.playlistId, video: videos })
    .from(playlistVideos)
    .innerJoin(videos, eq(videos.id, playlistVideos.videoId))
    .orderBy(desc(videos.publishedAt), asc(videos.id));

  return {
    // 動画のないプレイリストは出さない。不正な ID の動画は表示しない
    playlists: lists
      .map((list) => ({
        id: list.id,
        name: list.name,
        videos: rows
          .filter((row) => row.playlistId === list.id && isYoutubeId(row.video.youtubeId))
          .slice(0, LATEST_COUNT)
          .map(({ video }) => ({
            id: video.id,
            title: video.title,
            description: video.description ?? "",
            duration: video.durationSeconds ? formatDuration(video.durationSeconds) : null,
            url: watchUrl(video.youtubeId),
            embed: embedUrl(video.youtubeId),
            thumbnail: thumbnailUrl(video.youtubeId),
          })),
      }))
      .filter((list) => list.videos.length > 0),
  };
});

export const head = defineHead(() => ({ title: "NWU" }));
