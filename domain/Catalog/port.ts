import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../error.ts";
import type {
  FetchedVideo,
  Link,
  PlaylistInfo,
  StaleLinks,
  StoredVideoId,
  SyncPlaylist,
  YoutubeVideoItem,
} from "./type.ts";

/**
 * YouTube Data API v3. 値は API のまま返す (表示対象かどうかの判断はドメインでする)
 */
export interface YoutubePort {
  // プレイリストの動画 ID (全ページ, YouTube 上の順). 限定公開のプレイリストも ID がわかれば取れる (非公開は不可)
  fetchPlaylistVideoIds(playlistId: string): ResultAsync<string[], AppError>;

  // プレイリストのタイトルと説明. 取得できなかった ID (削除された・非公開など) は含めない
  fetchPlaylistInfos(
    playlistIds: string[],
  ): ResultAsync<Map<string, PlaylistInfo>, AppError>;

  // 動画の詳細. 存在しない ID は含めない
  fetchVideoItems(ids: string[]): ResultAsync<YoutubeVideoItem[], AppError>;
}

/**
 * 動画・プレイリスト・紐付けのリポジトリ
 */
export interface CatalogRepositoryPort {
  listPlaylists(): ResultAsync<SyncPlaylist[], AppError>;

  // プレイリストの名前と説明を上書きする
  updatePlaylistInfo(
    id: number,
    info: PlaylistInfo,
  ): ResultAsync<void, AppError>;

  listVideoIds(): ResultAsync<StoredVideoId[], AppError>;

  // 動画を保存する. 既にあれば (youtube_id が同じなら) タイトル・概要欄などを上書きする
  upsertVideos(videos: FetchedVideo[]): ResultAsync<void, AppError>;

  // 動画を保存する. 既にあれば何もしない (全件の同期と同時に動いても壊れないように). 保存できたものを返す
  insertNewVideos(
    videos: FetchedVideo[],
  ): ResultAsync<StoredVideoId[], AppError>;

  listLinks(): ResultAsync<Link[], AppError>;

  // 紐付けを外す
  deleteLinks(stale: StaleLinks): ResultAsync<void, AppError>;

  // 紐付けを保存する. 既にあれば並びを上書きする
  upsertLinks(links: Link[]): ResultAsync<void, AppError>;

  // 紐付けを保存する. 既にあれば何もしない
  insertLinks(links: Link[]): ResultAsync<void, AppError>;

  // どのプレイリストにも入っていない動画を消す. 消した数を返す
  deleteOrphanVideos(): ResultAsync<number, AppError>;
}
