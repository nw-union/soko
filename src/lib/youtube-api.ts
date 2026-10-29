// YouTube Data API v3 から、プレイリストの動画を取得する（crons/sync-videos.ts が使う）。
const API = "https://www.googleapis.com/youtube/v3";

// これ以下の長さはショートとみなして除外する
export const SHORT_MAX_SECONDS = 60;

export type FetchedVideo = {
  youtubeId: string;
  title: string;
  description: string;
  // ライブ中・配信予定のように、長さがまだない動画は null
  durationSeconds: number | null;
  publishedAt: string;
  // 概要欄のハッシュタグ（# なし）
  tags: string[];
};

// 概要欄のハッシュタグ。行頭か空白の後ろの #だけを拾う（URL の #t=10 などは除く）。
// 数字だけのものは YouTube もタグとして扱わない。大文字小文字だけが違うものは、先に出た方にまとめる
export const extractHashtags = (description: string): string[] => {
  const seen = new Map<string, string>();
  for (const m of description.matchAll(
    /(?:^|\s)#([\p{L}\p{N}_]{1,30})(?![\p{L}\p{N}_])/gu,
  )) {
    const tag = m[1];
    if (/^\p{N}+$/u.test(tag)) continue;
    const key = tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
};

// "PT1H2M3S" → 3723。長さのない "P0D"（ライブ中・配信予定）は null
export const parseIsoDuration = (iso: string): number | null => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const seconds =
    Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return seconds > 0 ? seconds : null;
};

const call = async <T>(
  path: string,
  params: Record<string, string>,
  key: string,
): Promise<T> => {
  const res = await fetch(
    `${API}/${path}?${new URLSearchParams({ ...params, key })}`,
  );
  if (!res.ok)
    throw new Error(`YouTube API ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

// プレイリストの動画 ID（全ページ）。限定公開のプレイリストも、ID がわかれば API キーで取れる（非公開は不可）
export const fetchPlaylistVideoIds = async (
  playlistId: string,
  key: string,
): Promise<string[]> => {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await call<{
      items: { contentDetails: { videoId: string } }[];
      nextPageToken?: string;
    }>(
      "playlistItems",
      {
        part: "contentDetails",
        playlistId,
        maxResults: "50",
        ...(pageToken ? { pageToken } : {}),
      },
      key,
    );
    ids.push(...res.items.map((item) => item.contentDetails.videoId));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return ids;
};

type VideoItem = {
  id: string;
  snippet: { title: string; description: string; publishedAt: string };
  contentDetails: { duration: string };
  status: { privacyStatus: string; embeddable: boolean };
};

// 動画 ID から詳細を引き、表示対象だけを返す。
// 非公開は除外、限定公開とライブは含める。ショートと埋め込み不可（アプリ内で再生できない）は除外する
export const fetchVideos = async (
  ids: string[],
  key: string,
): Promise<FetchedVideo[]> => {
  const result: FetchedVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const res = await call<{ items: VideoItem[] }>(
      "videos",
      {
        part: "snippet,contentDetails,status",
        id: ids.slice(i, i + 50).join(","),
      },
      key,
    );
    for (const item of res.items) {
      if (item.status.privacyStatus === "private" || !item.status.embeddable)
        continue;
      const durationSeconds = parseIsoDuration(item.contentDetails.duration);
      if (durationSeconds !== null && durationSeconds <= SHORT_MAX_SECONDS)
        continue;
      result.push({
        youtubeId: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        durationSeconds,
        publishedAt: item.snippet.publishedAt,
        tags: extractHashtags(item.snippet.description),
      });
    }
  }
  return result;
};
