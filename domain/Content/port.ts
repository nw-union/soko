import type { ResultAsync } from "neverthrow";
import type { AppError } from "../shared/error.ts";
import type { UserId, YoutubeId } from "../shared/vo.ts";
import type {
  FetchedVideo,
  Link,
  Member,
  Playlist,
  PlaylistInfo,
  PlaylistVideo,
  StaleLinks,
  StoredVideoId,
  VideoDate,
  Watch,
  YoutubeVideoItem,
} from "./type.ts";
import type { PlaylistId, PlaylistRowId } from "./vo.ts";

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
 * 動画・プレイリスト・紐付け・視聴記録のリポジトリ
 */
export interface ContentRepositoryPort {
  // ---- 読む (ホーム・バッジ) ----

  // プレイリスト (並び順: position, id の順)
  listPlaylists(): ResultAsync<Playlist[], AppError>;

  // プレイリストと動画の組. 投稿日時の新しい順 (日時のない動画は最後), 同じなら id の順
  listPlaylistVideos(): ResultAsync<PlaylistVideo[], AppError>;

  // どれかのプレイリストに入っている動画の投稿日時 (動画ごとに 1 件)
  listPlaylistVideoDates(): ResultAsync<VideoDate[], AppError>;

  // そのユーザーが見た動画の YouTube ID
  listWatchedIds(user: UserId): ResultAsync<string[], AppError>;

  // ユーザーたちの視聴記録
  listWatches(users: UserId[]): ResultAsync<Watch[], AppError>;

  // ユーザーたちの登録日時. 見つからないユーザーは含めない
  listMembers(users: UserId[]): ResultAsync<Member[], AppError>;

  // ---- 視聴記録 ----

  // 視聴記録を入れる. 登録済みの動画だけを受け付け (なければ何もしない), 既にあれば何もしない (最初に見た日時が残る)
  insertWatch(user: UserId, youtubeId: YoutubeId): ResultAsync<void, AppError>;

  // 視聴記録を消す. なくても成功
  deleteWatch(user: UserId, youtubeId: YoutubeId): ResultAsync<void, AppError>;

  // ---- プレイリストの管理 ----

  // プレイリストを足す. 同じ YouTube の ID が既にあれば何もせず null (確認と書き込みを 1 文で行う).
  // 並びは末尾 (position が同じなら id の順)
  insertPlaylist(id: PlaylistId): ResultAsync<Playlist | null, AppError>;

  // プレイリストを消す (動画との紐付けも消える). なくても成功. 動画自体は次の全件の同期が掃除する
  deletePlaylist(id: PlaylistRowId): ResultAsync<void, AppError>;

  // ---- YouTube からの取り込み ----

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
