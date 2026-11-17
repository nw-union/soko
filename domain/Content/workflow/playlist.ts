// ワークフロー: プレイリストの管理 (CreatePlaylist プレイリスト追加する・DeletePlaylist プレイリストを消す・プレイリストの一覧)
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { type AppError, newConflictError } from "../../shared/error.ts";
import type { ContentUsecase, CreatePlaylistEvt } from "../api.ts";
import { convToPlaylistSettingDto } from "../converter.ts";
import type { ContentRepositoryPort } from "../port.ts";
import { newPlaylistId, newPlaylistRowId } from "../vo.ts";

// ----------------------------------------------------------------------------
// 依存
// ----------------------------------------------------------------------------
type PlaylistRepository = Pick<
  ContentRepositoryPort,
  "listPlaylists" | "insertPlaylist" | "deletePlaylist"
>;

// ----------------------------------------------------------------------------
// 実装
// ----------------------------------------------------------------------------
/**
 * プレイリストの管理 (同期の対象の登録)
 */
export const newPlaylistWorkflow = (
  r: PlaylistRepository,
): Pick<
  ContentUsecase,
  "createPlaylist" | "deletePlaylist" | "listPlaylists"
> => ({
  /**
   * プレイリストを足す
   */
  createPlaylist: ({ playlistId }) =>
    // Step 1. バリデーション: string -> PlaylistId
    okAsync(playlistId)
      .andThen((src) => newPlaylistId(src, "playlistId"))
      // Step 2. DB 保存 (同じ ID が既にあれば null)
      .andThen((id) => r.insertPlaylist(id))
      // Step 3. 既にあれば Conflict
      .andThen(
        (list): ResultAsync<CreatePlaylistEvt, AppError> =>
          list
            ? okAsync({ playlist: convToPlaylistSettingDto(list) })
            : errAsync(
                newConflictError("そのプレイリストは既に登録されています"),
              ),
      ),

  /**
   * プレイリストを消す
   */
  deletePlaylist: ({ id }) =>
    // Step 1. バリデーション: string (URL のパスのまま) -> PlaylistRowId
    okAsync(id)
      .andThen((src) => newPlaylistRowId(Number(src), "id"))
      // Step 2. DB 削除
      .andThen((rowId) => r.deletePlaylist(rowId)),

  /**
   * プレイリストの一覧
   */
  listPlaylists: () =>
    r
      .listPlaylists()
      .map((lists) => ({ playlists: lists.map(convToPlaylistSettingDto) })),
});
