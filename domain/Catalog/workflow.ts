import { okAsync, ResultAsync } from "neverthrow";
import type { AppError } from "../../error.ts";
import type {
  CatalogWorkFlows,
  AllVideosSyncedEvt,
  NewVideosSyncedEvt,
} from "../../schema/service.ts";
import {
  canRemoveOrphans,
  planFullLinks,
  planNewLinks,
  playlistsToRename,
  toFetchedVideos,
  unknownVideoIds,
} from "./logic.ts";
import type { CatalogRepositoryPort, YoutubePort } from "./port.ts";
import type { SyncPlaylist } from "./type.ts";

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
 * @param yt - YouTube Data API. API キーが未設定なら null (同期しない)
 */
export const newCatalogWorkFlows = (
  r: CatalogRepositoryPort,
  yt: YoutubePort | null,
): CatalogWorkFlows => {
  /**
   * プレイリストごとの動画 ID (DB の ID → YouTube 上の順の動画 ID)
   */
  const fetchIdsByList = (youtube: YoutubePort, lists: SyncPlaylist[]) =>
    sequence(lists, (list) =>
      youtube
        .fetchPlaylistVideoIds(list.playlistId)
        .map((ids) => [list.id, ids] as const),
    ).map((pairs) => new Map(pairs));

  /**
   * API キーとプレイリストがあるときだけ進める
   */
  const withPlaylists = <E>(
    f: (
      youtube: YoutubePort,
      lists: SyncPlaylist[],
    ) => ResultAsync<E, AppError>,
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

  return {
    /**
     * 全件の同期
     */
    syncAllVideos: () =>
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
              (removed): AllVideosSyncedEvt => ({
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
    syncNewVideos: () =>
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
                (links): NewVideosSyncedEvt => ({
                  type: "Synced",
                  added: inserted.length,
                  links: links.length,
                }),
              ),
          ),
      ),
  };
};
