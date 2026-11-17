// ワークフロー: ホームと視聴 (Watch 視聴する・Unwatch 未視聴にする・ホームの動画・未視聴の New の本数)
import {
  err,
  ok,
  type Result,
  rslt,
  sequence,
  sequenceAsync,
  stepAsync,
} from "@nw-union/nw-utils/lib/rslt";
import { isYoutubeId } from "../../../lib/youtube.ts";
import {
  newValidationErrorWithMessage,
  type ValidationError,
} from "../../shared/error.ts";
import type { RandomPort } from "../../shared/port.ts";
import { newUserId, newYoutubeId, type YoutubeId } from "../../shared/vo.ts";
import type {
  ContentUsecase,
  HomeFeedView,
  PlaylistDto,
  VideoItemDto,
} from "../api.ts";
import { convToVideoItemDto } from "../converter.ts";
import type { ContentRepositoryPort } from "../port.ts";
import type {
  Member,
  Playlist,
  PlaylistVideo,
  VideoDate,
  Watch,
} from "../type.ts";

// ----------------------------------------------------------------------------
// 依存
// ----------------------------------------------------------------------------
type FeedRepository = Pick<
  ContentRepositoryPort,
  | "listPlaylists"
  | "listPlaylistVideos"
  | "listPlaylistVideoDates"
  | "listWatchedIds"
  | "listWatches"
  | "listMembers"
  | "insertWatch"
  | "deleteWatch"
>;

// ランダムに選ぶときの候補の数と, 選ぶ数 (画面の SLIDE_COUNT と同じ)
const RANDOM_POOL = 9;
const RANDOM_COUNT = 3;

// ----------------------------------------------------------------------------
// Step: バリデーション (Cmd / Query → ドメインの型)
// ----------------------------------------------------------------------------
/**
 * 視聴記録を付け外しする動画を検証する
 */
export const validateWatchedVideo = (
  youtubeId: unknown,
): Result<YoutubeId, ValidationError> =>
  rslt.pipe(
    newYoutubeId(youtubeId, "youtubeId"),
    rslt.mapErr(() =>
      newValidationErrorWithMessage(
        "youtubeId",
        "動画の指定が正しくありません",
      ),
    ),
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
// Step: ホームの組み立て・未視聴の New の本数
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
// 実装
// ----------------------------------------------------------------------------
/**
 * ホームと視聴 (ホームに並べる動画・視聴記録・未視聴の New の本数)
 */
export const newFeedWorkflow = (
  r: FeedRepository,
  random: RandomPort,
): Pick<
  ContentUsecase,
  "watch" | "unwatch" | "getHomeFeed" | "getBadgeCount" | "countUnwatchedNew"
> => {
  // ユーザーごとの, 未視聴の New の本数 (getBadgeCount と countUnwatchedNew で使う)
  const counts = (userIds: string[]) =>
    stepAsync(
      // Step 1. バリデーション: string[] -> UserId[]
      sequence(userIds.map((id) => newUserId(id))),
      // Step 2. 取得: UserId[] -> [Member[], VideoDate[], Watch[]]
      (users) =>
        users.length === 0
          ? ok(new Map<string, number>())
          : stepAsync(
              sequenceAsync([
                r.listMembers(users),
                r.listPlaylistVideoDates(),
                r.listWatches(users),
              ]),
              // Step 3. 数える
              ([members, videos, watches]) =>
                countUnwatchedNew(members, videos, watches),
            ),
    );

  return {
    /**
     * 動画を見たことを記録する
     */
    watch: ({ userId, youtubeId }) =>
      stepAsync(
        // Step 1. バリデーション: [string, unknown] -> [UserId, YoutubeId]
        sequence([newUserId(userId), validateWatchedVideo(youtubeId)]),
        // Step 2. DB 保存
        ([user, id]) => r.insertWatch(user, id),
      ),

    /**
     * 視聴記録を消して, 未視聴に戻す
     */
    unwatch: ({ userId, youtubeId }) =>
      stepAsync(
        // Step 1. バリデーション: [string, unknown] -> [UserId, YoutubeId]
        sequence([newUserId(userId), validateWatchedVideo(youtubeId)]),
        // Step 2. DB 削除
        ([user, id]) => r.deleteWatch(user, id),
      ),

    /**
     * ホームに並べる動画
     */
    getHomeFeed: ({ userId, joinedAt }) =>
      stepAsync(
        // Step 1. バリデーション: [string, Date] -> [UserId, number]
        sequence([newUserId(userId), validateJoinedAt(joinedAt)]),
        // Step 2. 取得: [UserId, number] -> [Playlist[], PlaylistVideo[], string[], number]
        ([user, joined]) =>
          stepAsync(
            sequenceAsync([
              r.listPlaylists(),
              r.listPlaylistVideos(),
              r.listWatchedIds(user),
            ]),
            ([lists, rows, watched]) => ({ lists, rows, watched, joined }),
          ),
        // Step 3. 組み立て
        ({ lists, rows, watched, joined }) =>
          buildHomeFeed(lists, rows, new Set(watched), joined, random.float),
      ),

    /**
     * バッジに出す, 未視聴の New の本数
     */
    getBadgeCount: ({ userId }) =>
      stepAsync(counts([userId]), (m) => ({ count: m.get(userId) ?? 0 })),

    /**
     * ユーザーごとの, 未視聴の New の本数
     */
    countUnwatchedNew: ({ userIds }) =>
      stepAsync(counts([...new Set(userIds)]), (m) => ({ counts: m })),
  };
};
