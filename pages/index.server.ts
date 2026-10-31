import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { asc, db, desc, eq } from "void/db";
import { playlists, playlistVideos, videos, videoWatches } from "@schema";
import {
  embedUrl,
  formatDuration,
  isYoutubeId,
  thumbnailUrl,
  watchUrl,
} from "../src/lib/youtube";

export type Props = InferProps<typeof loader>;

const RANDOM_POOL = 9;
const RANDOM_COUNT = 6;

// フィッシャー–イェーツのシャッフル。元の配列は変えない
const shuffle = <T>(items: T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export const loader = defineHandler(async (c) => {
  // 限定公開の動画も並ぶので、ミドルウェアだけに頼らずここでもログインを確かめる
  const user = getUser();
  if (!user) return c.redirect("/login");
  const lists = await db
    .select()
    .from(playlists)
    .orderBy(asc(playlists.position), asc(playlists.id));
  // プレイリストと動画の組。投稿日時の新しい順（日時のない動画は最後）
  const rows = await db
    .select({ playlistId: playlistVideos.playlistId, video: videos })
    .from(playlistVideos)
    .innerJoin(videos, eq(videos.id, playlistVideos.videoId))
    .orderBy(desc(videos.publishedAt), asc(videos.id));
  const watches = await db
    .select({ youtubeId: videoWatches.youtubeId })
    .from(videoWatches)
    .where(eq(videoWatches.userId, user.id));
  const watchedIds = new Set(watches.map((watch) => watch.youtubeId));

  // 不正な ID の動画は表示しない
  const valid = rows.filter((row) => isYoutubeId(row.video.youtubeId));
  // 投稿日時は日本時間の 2026.10.29 の形にする。日時のない動画は空
  const dateFormat = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formatDate = (iso: string | null) => {
    const date = iso ? new Date(iso) : null;
    return date && !Number.isNaN(date.getTime())
      ? dateFormat.format(date).replaceAll("/", ".")
      : null;
  };
  // tags は JSON 配列の文字列。壊れていても画面は落とさず、タグなしにする
  const parseTags = (json: string): string[] => {
    try {
      const tags: unknown = JSON.parse(json);
      return Array.isArray(tags)
        ? tags.filter((tag): tag is string => typeof tag === "string")
        : [];
    } catch {
      return [];
    }
  };
  const toItem = ({ video }: { video: (typeof rows)[number]["video"] }) => ({
    id: video.id,
    // 通知から開いたとき（/?v=…）に、どの動画かを探すのに使う
    youtubeId: video.youtubeId,
    title: video.title,
    description: video.description ?? "",
    duration: video.durationSeconds
      ? formatDuration(video.durationSeconds)
      : null,
    publishedAt: formatDate(video.publishedAt),
    tags: parseTags(video.tags),
    watched: watchedIds.has(video.youtubeId),
    url: watchUrl(video.youtubeId),
    embed: embedUrl(video.youtubeId),
    thumbnail: thumbnailUrl(video.youtubeId),
  });

  // 全プレイリストをまたいだ新着順。複数のプレイリストに入っている動画は 1 本にまとめる
  const seen = new Set<number>();
  const unique = valid.filter(
    (row) => !seen.has(row.video.id) && seen.add(row.video.id),
  );
  // New の候補。登録より後に投稿された動画（投稿日時のない動画は NaN で入らない）。
  // 未視聴の絞り込みと件数の制限は、画面側でする
  const joinedAt = new Date(user.createdAt).getTime();
  const newVideos = unique
    .filter((row) => Date.parse(row.video.publishedAt ?? "") >= joinedAt)
    .map(toItem);
  // New で足りない分を埋める動画。未視聴の New を除いた動画からランダムに 9 本選び、未視聴を優先して 6 本に絞り、並べ直す。
  // New を見終わって減ってもすぐ埋められるよう、常に 6 本作っておく
  const unwatchedNewIds = new Set(
    newVideos.filter((video) => !video.watched).map((video) => video.id),
  );
  const randomVideos = shuffle(
    shuffle(unique.map(toItem).filter((video) => !unwatchedNewIds.has(video.id)))
      .slice(0, RANDOM_POOL)
      .sort((a, b) => Number(a.watched) - Number(b.watched))
      .slice(0, RANDOM_COUNT),
  );

  return {
    newVideos,
    randomVideos,
    // 動画のないプレイリストは出さない
    playlists: lists
      .map((list) => ({
        id: list.id,
        name: list.name,
        videos: valid.filter((row) => row.playlistId === list.id).map(toItem),
      }))
      .filter((list) => list.videos.length > 0),
  };
});

export const head = defineHead(() => ({ title: "Soko" }));
