import {
  err,
  ok,
  type ResultAsync,
  sequence,
  sequenceAsync,
  stepAsync,
  throughAsync,
} from "@nw-union/nw-utils/lib/rslt";
import { type AppError, newConflictError } from "../shared/error.ts";
import { newUserId } from "../shared/vo.ts";
import type {
  AllSyncedEvt,
  ContentUsecase,
  CreatePlaylistEvt,
  NewSyncedEvt,
} from "./api.ts";
import { convToPlaylistSettingDto } from "./logic/dto.ts";
import { validateWatchedVideo } from "./logic/feed.ts";
import {
  canRemoveOrphans,
  planFullLinks,
  planNewLinks,
  playlistsToRename,
  unknownVideoIds,
} from "./logic/sync.ts";
import { toFetchedVideos } from "./logic/youtube.ts";
import type { ContentRepositoryPort, YoutubePort } from "./port.ts";
import type { Playlist } from "./type.ts";
import { newPlaylistId, newPlaylistRowId } from "./vo.ts";

/**
 * 1 つずつ順に実行する (YouTube への問い合わせを同時に投げない). 1 つでも失敗したら止める
 */
const inSeries = <T, U>(
  items: readonly T[],
  f: (item: T) => ResultAsync<U, AppError>,
): ResultAsync<U[], AppError> =>
  items.reduce<ResultAsync<U[], AppError>>(
    (acc, item) =>
      stepAsync(acc, (out) => stepAsync(f(item), (u) => [...out, u])),
    Promise.resolve(ok([])),
  );

type ContentCommands = Pick<
  ContentUsecase,
  | "syncAll"
  | "syncNew"
  | "createPlaylist"
  | "deletePlaylist"
  | "watch"
  | "unwatch"
>;

/**
 * コンテンツ集約のユースケースのうち, コマンド (状態を変えるもの). YouTube からの取り込み・プレイリストの登録・視聴記録
 *
 * @param yt - YouTube Data API. API キーが未設定なら null (同期しない)
 */
export const newContentWorkFlows = (
  r: ContentRepositoryPort,
  yt: YoutubePort | null,
): ContentCommands => {
  /**
   * プレイリストごとの動画 ID (DB の ID → YouTube 上の順の動画 ID)
   */
  const fetchIdsByList = (youtube: YoutubePort, lists: Playlist[]) =>
    stepAsync(
      inSeries(lists, (list) =>
        stepAsync(
          youtube.fetchPlaylistVideoIds(list.playlistId),
          (ids) => [list.id, ids] as const,
        ),
      ),
      (pairs) => new Map(pairs),
    );

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
    if (!youtube) return Promise.resolve(ok({ type: "NoApiKey" as const }));
    return stepAsync(r.listPlaylists(), (lists) =>
      lists.length === 0
        ? ok({ type: "NoPlaylists" as const })
        : f(youtube, lists),
    );
  };

  return {
    /**
     * 全件の同期
     */
    syncAll: () =>
      withPlaylists((youtube, lists) =>
        stepAsync(
          // Step 1. YouTube から取得 (動画 ID・プレイリスト情報・動画の詳細). ここまでは DB を変えない
          fetchIdsByList(youtube, lists),
          (idsByList) =>
            stepAsync(
              youtube.fetchPlaylistInfos(lists.map((list) => list.playlistId)),
              (infos) => ({ idsByList, infos }),
            ),
          ({ idsByList, infos }) =>
            stepAsync(
              youtube.fetchVideoItems([
                ...new Set([...idsByList.values()].flat()),
              ]),
              (items) => ({
                idsByList,
                infos,
                fetched: toFetchedVideos(items),
              }),
            ),
          // Step 2. プレイリストの名前と説明を YouTube に合わせる
          throughAsync(({ infos }) =>
            inSeries(playlistsToRename(lists, infos), ({ id, info }) =>
              r.updatePlaylistInfo(id, info),
            ),
          ),
          // Step 3. 動画を保存する (変更も直す)
          throughAsync(({ fetched }) => r.upsertVideos(fetched)),
          // Step 4. 紐付けを作り直す
          ({ idsByList, infos, fetched }) =>
            stepAsync(
              sequenceAsync([r.listVideoIds(), r.listLinks()]),
              ([stored, current]) =>
                planFullLinks(
                  lists,
                  idsByList,
                  stored,
                  new Set(fetched.map((video) => video.youtubeId)),
                  current,
                ),
              throughAsync(({ stale }) => inSeries(stale, r.deleteLinks)),
              throughAsync(({ links }) => r.upsertLinks(links)),
              ({ links }) => ({ infos, fetched, links: links.length }),
            ),
          // Step 5. どのプレイリストにも入っていない動画を消す (取得できた動画が 0 件なら消さない)
          ({ infos, fetched, links }) =>
            stepAsync(
              canRemoveOrphans(fetched) ? r.deleteOrphanVideos() : ok(0),
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
        stepAsync(
          // Step 1. プレイリストごとの動画 ID と, 保存されている動画
          sequenceAsync([fetchIdsByList(youtube, lists), r.listVideoIds()]),
          // Step 2. DB にない動画だけ詳細を引いて, 足す
          ([idsByList, stored]) => {
            const unknown = unknownVideoIds(idsByList, stored);
            return stepAsync(
              unknown.length === 0
                ? ok([])
                : stepAsync(youtube.fetchVideoItems(unknown), (items) =>
                    r.insertNewVideos(toFetchedVideos(items)),
                  ),
              (inserted) => ({ idsByList, stored, inserted }),
            );
          },
          // Step 3. 足りない紐付けを足す
          ({ idsByList, stored, inserted }) =>
            stepAsync(
              r.listLinks(),
              (current) =>
                planNewLinks(
                  lists,
                  idsByList,
                  [...stored, ...inserted],
                  current,
                ),
              throughAsync((links) => r.insertLinks(links)),
              (links): NewSyncedEvt => ({
                type: "Synced",
                added: inserted.length,
                links: links.length,
              }),
            ),
        ),
      ),

    /**
     * プレイリストを足す
     */
    createPlaylist: ({ playlistId }) =>
      stepAsync(
        ok(playlistId),
        // Step 1. バリデーション: string -> PlaylistId
        (src) => newPlaylistId(src, "playlistId"),
        // Step 2. DB 保存 (同じ ID が既にあれば null)
        (id) => r.insertPlaylist(id),
        // Step 3. 既にあれば Conflict
        (list) =>
          list
            ? ok<CreatePlaylistEvt>({
                playlist: convToPlaylistSettingDto(list),
              })
            : err(newConflictError("そのプレイリストは既に登録されています")),
      ),

    /**
     * プレイリストを消す
     */
    deletePlaylist: ({ id }) =>
      stepAsync(
        ok(id),
        // Step 1. バリデーション: string (URL のパスのまま) -> PlaylistRowId
        (src) => newPlaylistRowId(Number(src), "id"),
        // Step 2. DB 削除
        (rowId) => r.deletePlaylist(rowId),
      ),

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
  };
};
