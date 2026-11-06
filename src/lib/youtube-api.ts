// YouTube Data API v3 から、プレイリストの動画を取得する（crons/sync-videos.ts・crons/sync-new-videos.ts が使う）。
const API = "https://www.googleapis.com/youtube/v3";

export type FetchedVideo = {
  youtubeId: string;
  title: string;
  description: string;
  // ライブ中・配信予定のように、長さがまだない動画は null
  durationSeconds: number | null;
  // 動画の縦横比（幅 ÷ 高さ）。わからなければ null（16:9 として扱う）
  aspectRatio: number | null;
  publishedAt: string;
  // 概要欄のハッシュタグ（# なし）
  tags: string[];
};

// 概要欄のハッシュタグ。行頭か空白の後ろの #だけを拾う（URL の #t=10 などは除く）。
// 数字だけのものは YouTube もタグとして扱わない。大文字小文字だけが違うものは、先に出た方にまとめる
const extractHashtags = (description: string): string[] => {
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
const parseIsoDuration = (iso: string): number | null => {
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

// プレイリストのタイトルと説明（YouTube のプレイリストの「タイトル」「説明」欄）。プレイリスト ID → 内容で返す。
// 取得できなかった ID（削除された・非公開など）は含めない。50 件ずつ問い合わせる
export const fetchPlaylistInfos = async (
  playlistIds: string[],
  key: string,
): Promise<Map<string, { title: string; description: string }>> => {
  const result = new Map<string, { title: string; description: string }>();
  for (let i = 0; i < playlistIds.length; i += 50) {
    const res = await call<{
      items?: {
        id: string;
        snippet: { title: string; description: string };
      }[];
    }>(
      "playlists",
      {
        part: "snippet",
        id: playlistIds.slice(i, i + 50).join(","),
        maxResults: "50",
      },
      key,
    );
    for (const item of res.items ?? [])
      result.set(item.id, {
        title: item.snippet.title.trim(),
        description: item.snippet.description.trim(),
      });
  }
  return result;
};

// 埋め込みの iframe タグの width / height から縦横比を出す。読めない・極端な値は null
const parseEmbedAspectRatio = (embedHtml: string | undefined) => {
  const width = Number(embedHtml?.match(/\bwidth="(\d+)"/)?.[1]);
  const height = Number(embedHtml?.match(/\bheight="(\d+)"/)?.[1]);
  if (!(width > 0 && height > 0)) return null;
  const ratio = width / height;
  return ratio >= 0.4 && ratio <= 3 ? Math.round(ratio * 1000) / 1000 : null;
};

type VideoItem = {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    // "live"（ライブ中）・"upcoming"（配信予定・プレミア公開待ち）・"none"（通常の動画、配信が終わった動画）
    liveBroadcastContent: string;
  };
  contentDetails: { duration: string };
  // 埋め込みの iframe のタグ。幅と高さが動画の縦横比に合っている（16:9 なら 480×270、スクエアなら 480×480）
  player?: { embedHtml?: string };
  status: { privacyStatus: string; embeddable: boolean };
};

// 動画 ID から詳細を引き、表示対象だけを返す。
// 非公開は除外、限定公開は含める。ライブ中・配信予定（プレミア公開待ち）はまだ見られないので除外する。
// 配信が終わって通常の動画になったら、次の同期で入る。埋め込み不可（アプリ内で再生できない）も除外する
export const fetchVideos = async (
  ids: string[],
  key: string,
): Promise<FetchedVideo[]> => {
  const result: FetchedVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const res = await call<{ items: VideoItem[] }>(
      "videos",
      {
        part: "snippet,contentDetails,status,player",
        id: ids.slice(i, i + 50).join(","),
      },
      key,
    );
    for (const item of res.items) {
      if (item.status.privacyStatus === "private" || !item.status.embeddable)
        continue;
      if (item.snippet.liveBroadcastContent !== "none") continue;
      result.push({
        youtubeId: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        durationSeconds: parseIsoDuration(item.contentDetails.duration),
        aspectRatio: parseEmbedAspectRatio(item.player?.embedHtml),
        publishedAt: item.snippet.publishedAt,
        tags: extractHashtags(item.snippet.description),
      });
    }
  }
  return result;
};
