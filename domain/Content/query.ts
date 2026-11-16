import {
  ok,
  sequence,
  sequenceAsync,
  stepAsync,
} from "@nw-union/nw-utils/lib/rslt";
import type { RandomPort } from "../shared/port.ts";
import { newUserId } from "../shared/vo.ts";
import type { ContentUsecase } from "./api.ts";
import { convToPlaylistSettingDto } from "./logic/dto.ts";
import {
  buildHomeFeed,
  countUnwatchedNew,
  validateJoinedAt,
} from "./logic/feed.ts";
import type { ContentRepositoryPort } from "./port.ts";

type ContentQueries = Pick<
  ContentUsecase,
  "listPlaylists" | "getHomeFeed" | "getBadgeCount" | "countUnwatchedNew"
>;

/**
 * コンテンツ集約のユースケースのうち, Query (Read Model. 読むだけ). ホーム・バッジの本数・プレイリストの一覧
 */
export const newContentQueries = (
  r: ContentRepositoryPort,
  random: RandomPort,
): ContentQueries => {
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
     * プレイリストの一覧
     */
    listPlaylists: () =>
      stepAsync(r.listPlaylists(), (lists) => ({
        playlists: lists.map(convToPlaylistSettingDto),
      })),

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
