// YouTube Data API の値の解釈（YouTube の値 -> Domain Type）
import type { FetchedVideo, YoutubeVideoItem } from "../type.ts";

// ----------------------------------------------------------------------------
// Validater (YouTube の値 -> Domain Type)
// ----------------------------------------------------------------------------
/**
 * 概要欄のハッシュタグ. 行頭か空白の後ろの # だけを拾う (URL の #t=10 などは除く).
 * 数字だけのものは YouTube もタグとして扱わない. 大文字小文字だけが違うものは, 先に出た方にまとめる
 */
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

/**
 * "PT1H2M3S" → 3723. 長さのない "P0D" (ライブ中・配信予定) は null
 */
export const parseIsoDuration = (iso: string): number | null => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const seconds =
    Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return seconds > 0 ? seconds : null;
};

/**
 * 埋め込みの iframe タグの width / height から縦横比を出す. 読めない・極端な値は null
 */
export const parseEmbedAspectRatio = (embedHtml: string | undefined) => {
  const width = Number(embedHtml?.match(/\bwidth="(\d+)"/)?.[1]);
  const height = Number(embedHtml?.match(/\bheight="(\d+)"/)?.[1]);
  if (!(width > 0 && height > 0)) return null;
  const ratio = width / height;
  return ratio >= 0.4 && ratio <= 3 ? Math.round(ratio * 1000) / 1000 : null;
};

/**
 * 表示対象の動画か.
 * 非公開は除外, 限定公開は含める. ライブ中・配信予定 (プレミア公開待ち) はまだ見られないので除外する
 * (配信が終わって通常の動画になったら, 次の同期で入る). 埋め込み不可 (アプリ内で再生できない) も除外する
 */
export const isDisplayable = (item: YoutubeVideoItem): boolean =>
  item.privacyStatus !== "private" &&
  item.embeddable &&
  item.liveBroadcastContent === "none";

/**
 * YouTube の動画の詳細から, 表示対象の動画だけを取り込む形にする
 */
export const toFetchedVideos = (
  items: readonly YoutubeVideoItem[],
): FetchedVideo[] =>
  items.filter(isDisplayable).map((item) => ({
    youtubeId: item.id,
    title: item.title,
    description: item.description,
    durationSeconds: parseIsoDuration(item.duration),
    aspectRatio: parseEmbedAspectRatio(item.embedHtml),
    publishedAt: item.publishedAt,
    tags: extractHashtags(item.description),
  }));
