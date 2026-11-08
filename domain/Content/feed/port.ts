import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../../error.ts";
import type { UserId, YoutubeId } from "../../vo.ts";
import type {
  Member,
  Playlist,
  PlaylistVideo,
  VideoDate,
  Watch,
} from "./type.ts";

/**
 * ホームの動画と視聴記録のリポジトリ
 */
export interface FeedRepositoryPort {
  // プレイリスト (position, id の順)
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

  // 視聴記録を入れる. 登録済みの動画だけを受け付け (なければ何もしない), 既にあれば何もしない (最初に見た日時が残る)
  insertWatch(user: UserId, youtubeId: YoutubeId): ResultAsync<void, AppError>;

  // 視聴記録を消す. なくても成功
  deleteWatch(user: UserId, youtubeId: YoutubeId): ResultAsync<void, AppError>;
}
