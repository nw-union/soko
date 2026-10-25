import { defineHandler, defineHead, type InferProps } from "void";
import { asc, db, desc } from "void/db";
import { videos } from "@schema";
import { embedUrl, formatDuration, isYoutubeId, thumbnailUrl, watchUrl } from "../src/lib/youtube";

// tags 列は JSON の配列。壊れていたら、タグなしとして扱う
const parseTags = (raw: string): string[] => {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
};

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async () => {
  const rows = await db.select().from(videos).orderBy(asc(videos.position), desc(videos.publishedAt), asc(videos.id));
  return {
    // 不正な ID の行は表示しない
    videos: rows
      .filter((row) => isYoutubeId(row.youtubeId))
      .map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? "",
        duration: row.durationSeconds ? formatDuration(row.durationSeconds) : null,
        url: watchUrl(row.youtubeId),
        embed: embedUrl(row.youtubeId),
        thumbnail: thumbnailUrl(row.youtubeId),
        publishedAt: row.publishedAt,
        tags: parseTags(row.tags),
      })),
  };
});

export const head = defineHead(() => ({ title: "NWU" }));
