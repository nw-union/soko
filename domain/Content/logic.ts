import { err, ok, type Result } from "neverthrow";
import {
  embedUrl,
  formatDuration,
  isYoutubeId,
  thumbnailUrl,
  watchUrl,
} from "../rule/youtube.ts";
import {
  newValidationErrorWithMessage,
  type ValidationError,
} from "../shared/error.ts";
import { newYoutubeId, type YoutubeId } from "../shared/vo.ts";
import type {
  HomeFeedView,
  PlaylistDto,
  PlaylistSettingDto,
  VideoItemDto,
} from "./api.ts";
import type {
  FetchedVideo,
  Link,
  Member,
  Playlist,
  PlaylistInfo,
  PlaylistVideo,
  StaleLinks,
  StoredVideo,
  StoredVideoId,
  VideoDate,
  Watch,
  YoutubeVideoItem,
} from "./type.ts";

// ランダムに選ぶときの候補の数と, 選ぶ数 (画面の SLIDE_COUNT と同じ)
const RANDOM_POOL = 9;
const RANDOM_COUNT = 3;

// ----------------------------------------------------------------------------
// Domain Logic (Domain Type -> Domain Type)
// ----------------------------------------------------------------------------
/**
 * New は, 登録より後に投稿された動画 (投稿日時のない動画は NaN で入らない)
 */
export const isNewVideo = (publishedAt: string | null, joinedAt: number) =>
  Date.parse(publishedAt ?? "") >= joinedAt;

/**
 * フィッシャー–イェーツのシャッフル. 元の配列は変えない
 *
 * @param random - 0 以上 1 未満の乱数を返す関数
 */
export const shuffle = <T>(items: readonly T[], random: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * ホームに並べる動画を組み立てる
 *
 * @param lists - プレイリスト (並び順)
 * @param rows - プレイリストと動画の組 (投稿日時の新しい順)
 * @param watchedIds - そのユーザーが見た動画の YouTube ID
 * @param joinedAt - そのユーザーの登録日時 (ミリ秒)
 * @param random - 0 以上 1 未満の乱数を返す関数
 */
export const buildHomeFeed = (
  lists: readonly Playlist[],
  rows: readonly PlaylistVideo[],
  watchedIds: ReadonlySet<string>,
  joinedAt: number,
  random: () => number,
): HomeFeedView => {
  // 不正な ID の動画は表示しない
  const valid = rows.filter((row) => isYoutubeId(row.video.youtubeId));

  // 全プレイリストをまたいだ新着順. 複数のプレイリストに入っている動画は 1 本にまとめる.
  // 画面に渡す形への変換は, 動画ごとに 1 回だけ行う (New・ランダム・プレイリストで使い回す)
  const seen = new Set<number>();
  const entries = valid
    .filter((row) => !seen.has(row.video.id) && seen.add(row.video.id))
    .map((row) => ({
      item: convToVideoItemDto(row.video, watchedIds.has(row.video.youtubeId)),
      isNew: isNewVideo(row.video.publishedAt, joinedAt),
    }));
  const itemById = new Map(entries.map(({ item }) => [item.id, item]));

  // New の候補. 未視聴の絞り込みと件数の制限は, 画面側でする
  const newVideos = entries.filter((e) => e.isNew).map((e) => e.item);

  return {
    newVideos,
    randomVideos: pickRandomVideos(
      entries.map((e) => e.item),
      newVideos,
      random,
    ),
    // 動画のないプレイリストは出さない
    playlists: lists
      .map(
        (list): PlaylistDto => ({
          id: list.id,
          name: list.name,
          description: list.description,
          videos: valid
            .filter((row) => row.playlistId === list.id)
            .flatMap((row) => itemById.get(row.video.id) ?? []),
        }),
      )
      .filter((list) => list.videos.length > 0),
  };
};

/**
 * New で足りない分を埋める動画を選ぶ.
 * 未視聴の New を除いた動画からランダムに 9 本選び, 未視聴を優先して 3 本に絞り, 並べ直す.
 * New を見終わって減ってもすぐ埋められるよう, 常に 3 本作っておく
 */
export const pickRandomVideos = (
  items: readonly VideoItemDto[],
  newVideos: readonly VideoItemDto[],
  random: () => number,
): VideoItemDto[] => {
  const unwatchedNewIds = new Set(
    newVideos.filter((video) => !video.watched).map((video) => video.id),
  );
  return shuffle(
    shuffle(
      items.filter((video) => !unwatchedNewIds.has(video.id)),
      random,
    )
      .slice(0, RANDOM_POOL)
      .sort((a, b) => Number(a.watched) - Number(b.watched))
      .slice(0, RANDOM_COUNT),
    random,
  );
};

/**
 * ユーザーごとの, 未視聴の New の本数.
 * 画面は New を並べる本数を絞っているが, バッジは未視聴をすべて数える
 *
 * @param members - 数えるユーザー
 * @param videos - プレイリストに入っている動画 (トップページと同じく, それだけを数える)
 * @param watches - そのユーザーたちの視聴記録
 */
export const countUnwatchedNew = (
  members: readonly Member[],
  videos: readonly VideoDate[],
  watches: readonly Watch[],
): Map<string, number> => {
  const watched = new Set(watches.map((w) => `${w.userId}:${w.youtubeId}`));
  return new Map(
    members.map((member) => [
      member.id,
      videos.filter(
        (video) =>
          isYoutubeId(video.youtubeId) &&
          isNewVideo(video.publishedAt, member.joinedAt.getTime()) &&
          !watched.has(`${member.id}:${video.youtubeId}`),
      ).length,
    ]),
  );
};

// ----------------------------------------------------------------------------
// Validater (DTO -> Domain Type)
// ----------------------------------------------------------------------------
/**
 * 視聴記録を付け外しする動画を検証する
 */
export const validateWatchedVideo = (
  youtubeId: unknown,
): Result<YoutubeId, ValidationError> =>
  newYoutubeId(youtubeId, "youtubeId").mapErr(() =>
    newValidationErrorWithMessage("youtubeId", "動画の指定が正しくありません"),
  );

/**
 * 登録日時をミリ秒にする. 読めなければ ValidationError
 */
export const validateJoinedAt = (
  joinedAt: Date | string | number,
): Result<number, ValidationError> => {
  const ms = new Date(joinedAt).getTime();
  return Number.isNaN(ms)
    ? err(
        newValidationErrorWithMessage("joinedAt", "登録日時が正しくありません"),
      )
    : ok(ms);
};

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

// ----------------------------------------------------------------------------
// Domain Logic (全件の同期)
// ----------------------------------------------------------------------------
/**
 * 名前・説明を YouTube に合わせるプレイリスト.
 * YouTube を正として上書きする. YouTube から返ってこなかったもの (削除・非公開など) は, 今の値を残す
 */
export const playlistsToRename = (
  lists: readonly Playlist[],
  infos: ReadonlyMap<string, PlaylistInfo>,
): { id: number; info: PlaylistInfo }[] =>
  lists.flatMap((list) => {
    const info = infos.get(list.playlistId);
    if (!info) return [];
    if (info.title === list.name && info.description === list.description)
      return [];
    return [{ id: list.id, info }];
  });

/**
 * 紐付けを作り直す計画. 表示対象として取得できた動画だけを, プレイリストの順に結ぶ.
 * 同じ動画が 1 つのプレイリストに 2 回あっても, 最初の 1 回だけにする (並びは詰める)
 *
 * @param idsByList - プレイリスト (DB の ID) ごとの, YouTube 上の順の動画 ID
 * @param stored - 保存されている動画 (取り込んだ後)
 * @param fetchedIds - 表示対象として取得できた動画の YouTube ID
 * @param current - 今の紐付け
 * @returns stale: プレイリストから外れた (または表示対象でなくなった) 動画. links: あるべき紐付け
 */
export const planFullLinks = (
  lists: readonly Playlist[],
  idsByList: ReadonlyMap<number, readonly string[]>,
  stored: readonly StoredVideoId[],
  fetchedIds: ReadonlySet<string>,
  current: readonly Link[],
): { stale: StaleLinks[]; links: Link[] } => {
  const rowId = new Map(stored.map((row) => [row.youtubeId, row.id]));
  const stale: StaleLinks[] = [];
  const links: Link[] = [];
  for (const list of lists) {
    const wanted = new Map<number, number>(); // videoId → position
    for (const youtubeId of idsByList.get(list.id) ?? []) {
      const videoId = rowId.get(youtubeId);
      if (
        videoId !== undefined &&
        fetchedIds.has(youtubeId) &&
        !wanted.has(videoId)
      )
        wanted.set(videoId, wanted.size);
    }
    const staleIds = current
      .filter(
        (link) => link.playlistId === list.id && !wanted.has(link.videoId),
      )
      .map((link) => link.videoId);
    if (staleIds.length > 0)
      stale.push({ playlistId: list.id, videoIds: staleIds });
    for (const [videoId, position] of wanted)
      links.push({ playlistId: list.id, videoId, position });
  }
  return { stale, links };
};

/**
 * どのプレイリストにも入っていない動画を消してよいか.
 * 取得結果が空のときは, API の異常で全部消すことのないよう消さない
 */
export const canRemoveOrphans = (fetched: readonly FetchedVideo[]): boolean =>
  fetched.length > 0;

// ----------------------------------------------------------------------------
// Domain Logic (差分の同期)
// ----------------------------------------------------------------------------
/**
 * DB にない動画の YouTube ID (重複なし). 詳細を引くのはこれだけ
 */
export const unknownVideoIds = (
  idsByList: ReadonlyMap<number, readonly string[]>,
  stored: readonly StoredVideoId[],
): string[] => {
  const known = new Set(stored.map((row) => row.youtubeId));
  return [...new Set([...idsByList.values()].flat())].filter(
    (youtubeId) => !known.has(youtubeId),
  );
};

/**
 * 足りない紐付け. 新しい動画のほか, 既にある動画が別のプレイリストに入ったときも.
 * 既にある紐付けの並び替えはしない (全件の同期が直す). 並びは YouTube 上の位置のまま
 *
 * @param stored - 保存されている動画 (取り込んだ後)
 * @param current - 今の紐付け
 */
export const planNewLinks = (
  lists: readonly Playlist[],
  idsByList: ReadonlyMap<number, readonly string[]>,
  stored: readonly StoredVideoId[],
  current: readonly Pick<Link, "playlistId" | "videoId">[],
): Link[] => {
  const rowId = new Map(stored.map((row) => [row.youtubeId, row.id]));
  const linked = new Set(current.map((l) => `${l.playlistId}:${l.videoId}`));
  const links: Link[] = [];
  for (const list of lists) {
    (idsByList.get(list.id) ?? []).forEach((youtubeId, position) => {
      const videoId = rowId.get(youtubeId);
      const key = `${list.id}:${videoId}`;
      if (videoId === undefined || linked.has(key)) return;
      linked.add(key);
      links.push({ playlistId: list.id, videoId, position });
    });
  }
  return links;
};
