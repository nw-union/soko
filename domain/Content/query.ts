import { okAsync, Result, ResultAsync } from "neverthrow";
import type { ContentQueries } from "../../schema/service.ts";
import type { RandomPort } from "../port.ts";
import { newUserId } from "../vo.ts";
import {
  buildHomeFeed,
  convToPlaylistSettingDto,
  countUnwatchedNew,
  validateJoinedAt,
} from "./logic.ts";
import type { ContentRepositoryPort } from "./port.ts";

/**
 * コンテンツ集約の Queries (Read Model). ホーム・バッジの本数・プレイリストの一覧
 */
export const newContentQueries = (
  r: ContentRepositoryPort,
  random: RandomPort,
): ContentQueries => {
  // ユーザーごとの, 未視聴の New の本数 (getBadgeCount と countUnwatchedNew で使う)
  const counts = (userIds: string[]) =>
    // Step 1. バリデーション: string[] -> UserId[]
    okAsync(userIds)
      .andThen((ids) => Result.combine(ids.map((id) => newUserId(id))))
      // Step 2. 取得: UserId[] -> [Member[], VideoDate[], Watch[]]
      .andThen((users) =>
        users.length === 0
          ? okAsync(new Map<string, number>())
          : ResultAsync.combine([
              r.listMembers(users),
              r.listPlaylistVideoDates(),
              r.listWatches(users),
            ])
              // Step 3. 数える
              .map(([members, videos, watches]) =>
                countUnwatchedNew(members, videos, watches),
              ),
      );

  return {
    /**
     * プレイリストの一覧
     */
    listPlaylists: () =>
      r
        .listPlaylists()
        .map((lists) => ({ playlists: lists.map(convToPlaylistSettingDto) })),

    /**
     * ホームに並べる動画
     */
    getHomeFeed: ({ userId, joinedAt }) =>
      // Step 1. バリデーション: [string, Date] -> [UserId, number]
      okAsync(undefined)
        .andThen(() =>
          Result.combine([newUserId(userId), validateJoinedAt(joinedAt)]),
        )
        // Step 2. 取得: [UserId, number] -> [Playlist[], PlaylistVideo[], string[], number]
        .andThen(([user, joined]) =>
          ResultAsync.combine([
            r.listPlaylists(),
            r.listPlaylistVideos(),
            r.listWatchedIds(user),
          ]).map(([lists, rows, watched]) => ({
            lists,
            rows,
            watched,
            joined,
          })),
        )
        // Step 3. 組み立て
        .map(({ lists, rows, watched, joined }) =>
          buildHomeFeed(lists, rows, new Set(watched), joined, random.float),
        ),

    /**
     * バッジに出す, 未視聴の New の本数
     */
    getBadgeCount: ({ userId }) =>
      counts([userId]).map((m) => ({ count: m.get(userId) ?? 0 })),

    /**
     * ユーザーごとの, 未視聴の New の本数
     */
    countUnwatchedNew: ({ userIds }) =>
      counts([...new Set(userIds)]).map((m) => ({ counts: m })),
  };
};
