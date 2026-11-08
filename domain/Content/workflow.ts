import { errAsync, okAsync, Result, ResultAsync } from "neverthrow";
import { type AppError, newConflictError } from "../../error.ts";
import type {
  AllSyncedEvt,
  ContentWorkFlows,
  NewSyncedEvt,
  PlaylistSettingDto,
} from "../../schema/service.ts";
import type { RandomPort } from "../port.ts";
import { newUserId } from "../vo.ts";
import {
  buildHomeFeed,
  canRemoveOrphans,
  countUnwatchedNew,
  planFullLinks,
  planNewLinks,
  playlistsToRename,
  toFetchedVideos,
  unknownVideoIds,
  validateJoinedAt,
  validateWatchedVideo,
} from "./logic.ts";
import type { ContentRepositoryPort, YoutubePort } from "./port.ts";
import type { Playlist } from "./type.ts";
import { newPlaylistId, newPlaylistRowId } from "./vo.ts";

const toSettingDto = (list: Playlist): PlaylistSettingDto => ({
  id: list.id,
  playlistId: list.playlistId,
  name: list.name,
});

/**
 * 1 つずつ順に実行する (YouTube への問い合わせを同時に投げない). 1 つでも失敗したら止める
 */
const sequence = <T, U>(
  items: readonly T[],
  f: (item: T) => ResultAsync<U, AppError>,
): ResultAsync<U[], AppError> =>
  items.reduce<ResultAsync<U[], AppError>>(
    (acc, item) => acc.andThen((out) => f(item).map((u) => [...out, u])),
    okAsync([]),
  );

/**
 * コンテンツ集約の WorkFlows. YouTube からの取り込みと, ホーム・視聴記録
 *
 * @param yt - YouTube Data API. API キーが未設定なら null (同期しない)
 */
export const newContentWorkFlows = (
  r: ContentRepositoryPort,
  yt: YoutubePort | null,
  random: RandomPort,
): ContentWorkFlows => {
  /**
   * プレイリストごとの動画 ID (DB の ID → YouTube 上の順の動画 ID)
   */
  const fetchIdsByList = (youtube: YoutubePort, lists: Playlist[]) =>
    sequence(lists, (list) =>
      youtube
        .fetchPlaylistVideoIds(list.playlistId)
        .map((ids) => [list.id, ids] as const),
    ).map((pairs) => new Map(pairs));

  /**
   * API キーとプレイリストがあるときだけ進める
   */
  const withPlaylists = <E>(
    f: (youtube: YoutubePort, lists: Playlist[]) => ResultAsync<E, AppError>,
  ): ResultAsync<
    E | { type: "NoApiKey" } | { type: "NoPlaylists" },
    AppError
  > => {
    const youtube = yt;
    if (!youtube) return okAsync({ type: "NoApiKey" as const });
    return r
      .listPlaylists()
      .andThen((lists) =>
        lists.length === 0
          ? okAsync({ type: "NoPlaylists" as const })
          : f(youtube, lists),
      );
  };

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
     * 全件の同期
     */
    syncAll: () =>
      withPlaylists((youtube, lists) =>
        // Step 1. YouTube から取得 (動画 ID・プレイリスト情報・動画の詳細). ここまでは DB を変えない
        fetchIdsByList(youtube, lists)
          .andThen((idsByList) =>
            youtube
              .fetchPlaylistInfos(lists.map((list) => list.playlistId))
              .andThen((infos) =>
                youtube
                  .fetchVideoItems([...new Set([...idsByList.values()].flat())])
                  .map((items) => ({
                    idsByList,
                    infos,
                    fetched: toFetchedVideos(items),
                  })),
              ),
          )
          // Step 2. プレイリストの名前と説明を YouTube に合わせる
          .andThrough(({ infos }) =>
            sequence(playlistsToRename(lists, infos), ({ id, info }) =>
              r.updatePlaylistInfo(id, info),
            ),
          )
          // Step 3. 動画を保存する (変更も直す)
          .andThrough(({ fetched }) => r.upsertVideos(fetched))
          // Step 4. 紐付けを作り直す
          .andThen(({ idsByList, infos, fetched }) =>
            ResultAsync.combine([r.listVideoIds(), r.listLinks()])
              .map(([stored, current]) =>
                planFullLinks(
                  lists,
                  idsByList,
                  stored,
                  new Set(fetched.map((video) => video.youtubeId)),
                  current,
                ),
              )
              .andThrough(({ stale }) => sequence(stale, r.deleteLinks))
              .andThrough(({ links }) => r.upsertLinks(links))
              .map(({ links }) => ({ infos, fetched, links: links.length })),
          )
          // Step 5. どのプレイリストにも入っていない動画を消す (取得できた動画が 0 件なら消さない)
          .andThen(({ infos, fetched, links }) =>
            (canRemoveOrphans(fetched)
              ? r.deleteOrphanVideos()
              : okAsync(0)
            ).map(
              (removed): AllSyncedEvt => ({
                type: "Synced",
                videos: fetched.length,
                playlists: lists.length,
                links,
                removed,
                removalSkipped: !canRemoveOrphans(fetched),
                renamed: playlistsToRename(lists, infos).length,
              }),
            ),
          ),
      ),

    /**
     * 差分の同期
     */
    syncNew: () =>
      withPlaylists((youtube, lists) =>
        // Step 1. プレイリストごとの動画 ID と, 保存されている動画
        ResultAsync.combine([fetchIdsByList(youtube, lists), r.listVideoIds()])
          // Step 2. DB にない動画だけ詳細を引いて, 足す
          .andThen(([idsByList, stored]) => {
            const unknown = unknownVideoIds(idsByList, stored);
            return (
              unknown.length === 0
                ? okAsync([])
                : youtube
                    .fetchVideoItems(unknown)
                    .andThen((items) =>
                      r.insertNewVideos(toFetchedVideos(items)),
                    )
            ).map((inserted) => ({ idsByList, stored, inserted }));
          })
          // Step 3. 足りない紐付けを足す
          .andThen(({ idsByList, stored, inserted }) =>
            r
              .listLinks()
              .map((current) =>
                planNewLinks(
                  lists,
                  idsByList,
                  [...stored, ...inserted],
                  current,
                ),
              )
              .andThrough((links) => r.insertLinks(links))
              .map(
                (links): NewSyncedEvt => ({
                  type: "Synced",
                  added: inserted.length,
                  links: links.length,
                }),
              ),
          ),
      ),

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
     * プレイリストの一覧
     */
    listPlaylists: () =>
      r
        .listPlaylists()
        .map((lists) => ({ playlists: lists.map(toSettingDto) })),

    /**
     * プレイリストを足す
     */
    createPlaylist: ({ playlistId }) =>
      // Step 1. バリデーション: unknown -> PlaylistId
      okAsync(playlistId)
        .andThen((src) => newPlaylistId(src, "playlistId"))
        // Step 2. DB 保存 (同じ ID が既にあれば null)
        .andThen((id) => r.insertPlaylist(id))
        // Step 3. 既にあれば Conflict
        .andThen(
          (list): ResultAsync<PlaylistSettingDto, AppError> =>
            list
              ? okAsync(toSettingDto(list))
              : errAsync(
                  newConflictError("そのプレイリストは既に登録されています"),
                ),
        ),

    /**
     * プレイリストを消す
     */
    deletePlaylist: ({ id }) =>
      // Step 1. バリデーション: unknown -> PlaylistRowId
      okAsync(id)
        .andThen((src) => newPlaylistRowId(src, "id"))
        // Step 2. DB 削除
        .andThen((rowId) => r.deletePlaylist(rowId)),

    /**
     * 動画を見たことを記録する
     */
    watch: ({ userId, youtubeId }) =>
      // Step 1. バリデーション: [string, unknown] -> [UserId, YoutubeId]
      okAsync(undefined)
        .andThen(() =>
          Result.combine([newUserId(userId), validateWatchedVideo(youtubeId)]),
        )
        // Step 2. DB 保存
        .andThen(([user, id]) => r.insertWatch(user, id)),

    /**
     * 視聴記録を消して, 未視聴に戻す
     */
    unwatch: ({ userId, youtubeId }) =>
      // Step 1. バリデーション: [string, unknown] -> [UserId, YoutubeId]
      okAsync(undefined)
        .andThen(() =>
          Result.combine([newUserId(userId), validateWatchedVideo(youtubeId)]),
        )
        // Step 2. DB 削除
        .andThen(([user, id]) => r.deleteWatch(user, id)),

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
