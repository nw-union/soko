// コンテンツ集約の入口の I/F（アプリケーションサービス）: WorkFlows（コマンド）と Queries（Read Model）、Cmd / Evt / Query / View / DTO。
// Web 層（pages/ routes/ crons/ auth.ts）は、ここに定義した型と server/container.ts の WorkFlows・Queries だけを使う。
// 入力（Cmd / Query）は画面や API から来た値のまま受け取り、検証はドメインで行う。
// 出口の I/F（副作用）は port.ts に置く
import type { ResultAsync } from "neverthrow";
import type { AppError } from "../shared/error.ts";

/**
 * コンテンツ集約のコマンド: 動画の取り込み (YouTube との同期), プレイリストの登録, 視聴の記録
 */
export interface ContentWorkFlows {
  /**
   * 全件の同期. playlists に登録されたプレイリストの全動画を取り直して
   * videos に反映し (タイトル・概要欄などの変更も直す), 紐付けを作り直す.
   * プレイリストの名前と説明も YouTube に合わせる.
   * どのプレイリストにも入っていない動画は消す.
   *
   * 先に YouTube からすべて取得し, 1 つでも失敗したら DB は何も変えない
   * (DB への書き込みが始まった後の失敗では, 一部だけ反映されることがある. 次回の同期で直る)
   */
  syncAll(): ResultAsync<AllSyncedEvt, AppError>;

  /**
   * 差分の同期. プレイリストに増えた動画だけを足して紐付ける.
   * 既にある動画の更新・並び替え・削除はしない (全件の同期が直す)
   */
  syncNew(): ResultAsync<NewSyncedEvt, AppError>;

  /**
   * プレイリストを足す. 同じ YouTube の ID が既にあれば ConflictError.
   * 動画は次の同期で取り込まれる
   */
  createPlaylist(
    cmd: CreatePlaylistCmd,
  ): ResultAsync<PlaylistSettingDto, AppError>;

  /**
   * プレイリストを消す (動画との紐付けも消える). なくても成功.
   * 他のプレイリストに入っていない動画は次の全件の同期で消える
   */
  deletePlaylist(cmd: DeletePlaylistCmd): ResultAsync<void, AppError>;

  /**
   * 動画を見たことを記録する.
   * 登録済みの動画だけを受け付け, 何度送っても 1 件のまま (最初に見た日時が残る)
   */
  watch(cmd: WatchCmd): ResultAsync<void, AppError>;

  /**
   * 視聴記録を消して, 未視聴に戻す
   */
  unwatch(cmd: UnwatchCmd): ResultAsync<void, AppError>;
}

/**
 * コンテンツ集約の Read Model: ホーム・バッジの本数・プレイリストの一覧
 */
export interface ContentQueries {
  /**
   * プレイリストの一覧 (並び順). 同期の対象になっているもの
   */
  listPlaylists(): ResultAsync<PlaylistSettingsView, AppError>;

  /**
   * ホームに並べる動画 (New の候補・ランダムに選んだ動画・プレイリストごとの動画)
   *
   * New の未視聴の絞り込みと件数の制限は, 画面側でする (見た動画をその場で外すため)
   */
  getHomeFeed(q: GetHomeFeedQuery): ResultAsync<HomeFeedView, AppError>;

  /**
   * アプリのアイコンのバッジに出す, 未視聴の New の本数
   */
  getBadgeCount(q: GetBadgeCountQuery): ResultAsync<BadgeCountView, AppError>;

  /**
   * ユーザーごとの, 未視聴の New の本数 (通知のバッジに使う)
   */
  countUnwatchedNew(
    q: CountUnwatchedNewQuery,
  ): ResultAsync<UnwatchedNewCountsView, AppError>;
}

export type SyncSkipped =
  // YOUTUBE_API_KEY が未設定
  | { type: "NoApiKey" }
  // playlists にプレイリストが登録されていない
  | { type: "NoPlaylists" };

// Evt: 全件更新した
export type AllSyncedEvt =
  | SyncSkipped
  | {
      type: "Synced";
      // 表示対象として取得できた動画の数
      videos: number;
      playlists: number;
      // 結んだ紐付けの数
      links: number;
      // 消した動画の数
      removed: number;
      // 取得できた動画が 0 件だったので, 動画を消さなかった
      removalSkipped: boolean;
      // 名前・説明を更新したプレイリストの数
      renamed: number;
    };

// Evt: 差分更新した
export type NewSyncedEvt =
  | SyncSkipped
  | {
      type: "Synced";
      // 足した動画の数
      added: number;
      // 足した紐付けの数
      links: number;
    };

// Cmd: 視聴する
export type WatchCmd = { userId: string; youtubeId: unknown };

// Cmd: 未視聴にする
export type UnwatchCmd = { userId: string; youtubeId: unknown };

// Cmd: プレイリストを足す
export type CreatePlaylistCmd = { playlistId: unknown };

// Cmd: プレイリストを消す (id は playlists の ID)
export type DeletePlaylistCmd = { id: unknown };

export type PlaylistSettingsView = { playlists: PlaylistSettingDto[] };

// 管理画面に出すプレイリスト
export type PlaylistSettingDto = {
  // playlists の ID
  id: number;
  // YouTube のプレイリスト ID
  playlistId: string;
  // 同期で YouTube から取った名前. まだ同期していなければ空
  name: string;
};

export type GetHomeFeedQuery = {
  userId: string;
  // 登録日時. これより後に投稿された動画が New
  joinedAt: Date | string | number;
};

export type HomeFeedView = {
  // New の候補 (新しい順)
  newVideos: VideoItemDto[];
  // New で足りない分を埋める動画 (未視聴の New を除いて, ランダムに選ぶ)
  randomVideos: VideoItemDto[];
  // 動画のあるプレイリストだけ (並び順)
  playlists: PlaylistDto[];
};

export type PlaylistDto = {
  id: number;
  name: string;
  description: string;
  // 新しい順
  videos: VideoItemDto[];
};

export type VideoItemDto = {
  id: number;
  // 通知から開いたとき (/?v=…) に, どの動画かを探すのに使う
  youtubeId: string;
  title: string;
  description: string;
  // "3:33" / "1:02:03". わからなければ null
  duration: string | null;
  // 再生画面の枠の縦横比. わからない動画は 16:9
  aspectRatio: number;
  // 日本時間の "2026.10.29". わからなければ null
  publishedAt: string | null;
  tags: string[];
  watched: boolean;
  url: string;
  embed: string;
  thumbnail: string;
};

export type GetBadgeCountQuery = { userId: string };
export type BadgeCountView = { count: number };

export type CountUnwatchedNewQuery = { userIds: string[] };
export type UnwatchedNewCountsView = {
  // ユーザー ID → 本数. 見つからなかったユーザーは含めない
  counts: Map<string, number>;
};
