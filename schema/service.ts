// アプリケーションサービスの I/F。Web 層（pages/ routes/ crons/ auth.ts）は、ここに定義した WorkFlows だけを呼ぶ。
// 入力（Cmd）は画面や API から来た値のまま受け取り、検証はドメインで行う
import type { ResultAsync } from "neverthrow";
import type { AppError } from "../error.ts";

// イベストの 3 つの集約（Content・Notification・Member）ごとに WorkFlows を定義する。
// Web 層は container() の contentWorkFlows・notificationWorkFlows・memberWorkFlows を呼ぶ

// ============================================================================
// Content
// ============================================================================

/**
 * コンテンツ集約: 動画の取り込み (YouTube との同期) と, 見る・記録する
 */
export interface ContentWorkFlows {
  /**
   * 全件の同期. playlists に登録されたプレイリストの全動画を取り直して videos に反映し (タイトル・概要欄などの変更も直す),
   * 紐付けを作り直す. プレイリストの名前と説明も YouTube に合わせる. どのプレイリストにも入っていない動画は消す.
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
   * 動画を見たことを記録する. 登録済みの動画だけを受け付け, 何度送っても 1 件のまま (最初に見た日時が残る)
   */
  watch(cmd: WatchCmd): ResultAsync<void, AppError>;

  /**
   * 視聴記録を消して, 未視聴に戻す
   */
  unwatch(cmd: UnwatchCmd): ResultAsync<void, AppError>;

  /**
   * ホームに並べる動画 (New の候補・ランダムに選んだ動画・プレイリストごとの動画)
   *
   * New の未視聴の絞り込みと件数の制限は, 画面側でする (見た動画をその場で外すため)
   */
  getHomeFeed(cmd: GetHomeFeedCmd): ResultAsync<HomeFeedEvt, AppError>;


  /**
   * アプリのアイコンのバッジに出す, 未視聴の New の本数
   */
  getBadgeCount(cmd: GetBadgeCountCmd): ResultAsync<GetBadgeCountEvt, AppError>;

  /**
   * ユーザーごとの, 未視聴の New の本数 (通知のバッジに使う)
   */
  countUnwatchedNew(
    cmd: CountUnwatchedNewCmd,
  ): ResultAsync<CountUnwatchedNewEvt, AppError>;
}

export type SyncSkipped =
  // YOUTUBE_API_KEY が未設定
  | { type: "NoApiKey" }
  // playlists にプレイリストが登録されていない
  | { type: "NoPlaylists" };

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

export type NewSyncedEvt =
  | SyncSkipped
  | {
      type: "Synced";
      // 足した動画の数
      added: number;
      // 足した紐付けの数
      links: number;
    };

export type GetHomeFeedCmd = {
  userId: string;
  // 登録日時. これより後に投稿された動画が New
  joinedAt: Date | string | number;
};

export type HomeFeedEvt = {
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

export type WatchCmd = { userId: string; youtubeId: unknown };
export type UnwatchCmd = { userId: string; youtubeId: unknown };

export type GetBadgeCountCmd = { userId: string };
export type GetBadgeCountEvt = { count: number };

export type CountUnwatchedNewCmd = { userIds: string[] };
export type CountUnwatchedNewEvt = {
  // ユーザー ID → 本数. 見つからなかったユーザーは含めない
  counts: Map<string, number>;
};

// ============================================================================
// Notification
// ============================================================================

/**
 * 通知集約: Web Push の購読と、新着動画の通知
 */
export interface NotificationWorkFlows {
  /**
   * 購読に使う VAPID の公開鍵. サーバーに鍵がなければ null (通知の設定を出さない)
   */
  getPublicKey(): ResultAsync<GetPublicKeyEvt, AppError>;

  /**
   * 購読を保存する. 同じ端末なら, ログインしているユーザーと鍵を上書きする.
   * 1 人が持てる購読は 10 件まで (超えたら古いものから消す)
   */
  subscribe(cmd: SubscribeCmd): ResultAsync<void, AppError>;

  /**
   * 購読を消す (通知をオフにしたとき・ログアウトするとき)
   */
  unsubscribe(cmd: UnsubscribeCmd): ResultAsync<void, AppError>;

  /**
   * まだ通知していない動画を通知済みにして, そのうち最近のものを全購読者に 1 通で知らせる.
   * 新規追加動画があった場合に, ポリシー (server/policy.ts) が呼ぶ. 全件の同期の cron も, 取りこぼしを拾うために呼ぶ
   */
  notifyNewVideos(): ResultAsync<NewVideosNotifiedEvt, AppError>;
}

export type GetPublicKeyEvt = { publicKey: string | null };

export type SubscribeCmd = {
  userId: string;
  // ブラウザの PushSubscription.toJSON() のまま
  body: unknown;
};

export type UnsubscribeCmd = { userId: string; endpoint: unknown };

export type NewVideosNotifiedEvt =
  // 通知する (最近の) 新着がなかった
  | { type: "NoRecentVideos" }
  // VAPID の鍵がないので送らなかった (動画は通知済みにした)
  | { type: "NoVapidKeys"; videos: number }
  | {
      type: "Notified";
      // 通知した動画の本数
      videos: number;
      // 届いた数 / 送った数
      sent: number;
      total: number;
      // 端末が購読をやめていたので消した数
      removed: number;
      // 届かなかった理由 (プッシュサービスの応答のステータスなど)
      failures: string[];
      // バッジの本数を数えられなかった理由 (それでも通知は送る)
      badgeError: string | null;
    };

// ============================================================================
// Member
// ============================================================================

/**
 * メンバー集約: 招待と, プロフィール・ログイン
 */
export interface MemberWorkFlows {
  // --- 招待 (domain/Member/invite) ---

  /**
   * 自分が発行した招待の一覧と, あと何回発行できるか
   */
  listInvites(cmd: ListInvitesCmd): ResultAsync<ListInvitesEvt, AppError>;

  /**
   * 招待を発行する. 上限に達していれば ConflictError
   *
   * トークンはここで 1 回だけ返す (DB にはハッシュしか残らない)
   */
  issueInvite(cmd: IssueInviteCmd): ResultAsync<IssueInviteEvt, AppError>;

  /**
   * 未使用の招待を取り消す (枠が戻る). 使用済み・他人の招待・存在しない ID は何もしない
   */
  revokeInvite(cmd: RevokeInviteCmd): ResultAsync<void, AppError>;

  /**
   * 登録の入口. 招待トークンが今使えるか確かめ, 正規化したトークンを返す (Web 層が Cookie に入れる)
   *
   * 使えない理由は教えない (形式違い・存在しない・使用済み・期限切れは, すべて同じ ValidationError)
   */
  startInvite(cmd: StartInviteCmd): ResultAsync<StartInviteEvt, AppError>;

  /**
   * 登録 (ユーザー作成) の直前に, 招待を使用済みにする
   *
   * 同じトークンで同時に登録されても, 成功するのは 1 回だけ. 失敗の理由は startInvite と同じく教えない
   */
  claimInvite(cmd: ClaimInviteCmd): ResultAsync<void, AppError>;

  /**
   * 登録 (ユーザー作成) の直後に, 使用済みにした招待へ, 作られたユーザーを結び付ける
   */
  linkInvitedUser(cmd: LinkInvitedUserCmd): ResultAsync<void, AppError>;

  // --- プロフィール・ログイン (domain/Member/profile) ---

  /**
   * プロフィールの更新 (better-auth の update-user) で送られてきた値を確かめる.
   * 名前は前後の空白を除いて返す. 画像はここでは設定できない
   */
  validateProfileUpdate(
    cmd: ValidateProfileCmd,
  ): ResultAsync<ValidateProfileEvt, AppError>;

  /**
   * 登録 (better-auth の sign-up) で送られてきた値を確かめる. メールアドレスは使い捨てのものだけ
   */
  validateSignUp(
    cmd: ValidateSignUpCmd,
  ): ResultAsync<ValidateProfileEvt, AppError>;

  /**
   * 画面に出すユーザー (全ページで共通に使う, 表示に必要な最小限)
   */
  getDisplayUser(cmd: GetDisplayUserCmd): ResultAsync<DisplayUserDto, AppError>;

  /**
   * パスキーを作ったか. パスキーがログインの唯一の手段なので, まだ作っていない (登録の途中の) 人は /welcome から出さない
   */
  hasPasskey(cmd: HasPasskeyCmd): ResultAsync<HasPasskeyEvt, AppError>;

  /**
   * アイコン画像を差し替える. 古い画像は消す (消せなくても差し替えは成功させる)
   */
  changeAvatar(cmd: ChangeAvatarCmd): ResultAsync<ChangeAvatarEvt, AppError>;

  /**
   * アイコン画像を外して, 頭文字の表示に戻す
   */
  removeAvatar(cmd: RemoveAvatarCmd): ResultAsync<void, AppError>;

  /**
   * 退会したユーザーの後始末 (アイコン画像・未使用の招待・通知の購読・視聴記録)
   */
  cleanupDeletedUser(cmd: CleanupDeletedUserCmd): ResultAsync<void, AppError>;

  /**
   * パスキーを削除してよいか確かめる.
   * ログインし直したばかりでなければ ForbiddenError (code: SESSION_NOT_FRESH), 最後のパスキーなら ValidationError
   */
  checkPasskeyDeletion(
    cmd: CheckPasskeyDeletionCmd,
  ): ResultAsync<void, AppError>;
}

export type ListInvitesCmd = { userId: string };
export type ListInvitesEvt = {
  limit: number;
  remaining: number;
  invites: InviteDto[];
};

export type IssueInviteCmd = { userId: string };
export type IssueInviteEvt = {
  // 画面に出す形 (XXXX-XXXX-XXXX-XXXX)
  token: string;
  // 有効日数
  days: number;
};

export type RevokeInviteCmd = {
  userId: string;
  // クエリ文字列のまま
  id: unknown;
};

export type StartInviteCmd = { token: unknown };
export type StartInviteEvt = {
  // 正規化したトークン (大文字・ハイフンなし)
  token: string;
};

export type ClaimInviteCmd = { token: unknown };
export type LinkInvitedUserCmd = { token: unknown; userId: string };

/**
 * InviteDto
 *
 * 日時は SQLite の "YYYY-MM-DD HH:MM:SS" (UTC) のまま渡す (画面側でパースしている)
 */
export type InviteDto = {
  id: number;
  createdAt: string;
  // 空なら無期限
  expiresAt: string | null;
  // 空なら未使用
  usedAt: string | null;
  // 使ったユーザーの名前. 未使用やユーザー削除済みなら空
  usedByName: string | null;
};

export type ValidateProfileCmd = {
  name?: unknown;
  color?: unknown;
  image?: unknown;
};
export type ValidateSignUpCmd = ValidateProfileCmd & { email: unknown };
export type ValidateProfileEvt = {
  // 送られてこなかった項目は含めない (変更しない)
  name?: string;
  // null はイメージカラーを外す
  color?: string | null;
};

export type GetDisplayUserCmd = {
  user: { id: string; name: string; color?: unknown; image?: unknown };
};
export type DisplayUserDto = {
  name: string;
  // #rrggbb. 未設定ならユーザー ID から決まる色
  color: string;
  // このアプリで保存したアイコンのパスか, http(s) の URL. なければ null
  image: string | null;
};

export type HasPasskeyCmd = { userId: string };
export type HasPasskeyEvt = { hasPasskey: boolean };

export type ChangeAvatarCmd = {
  userId: string;
  // アップロードされたファイルの中身. ファイルが送られてこなければ null
  file: Uint8Array | null;
};
export type ChangeAvatarEvt = {
  // user.image に入れたパス
  image: string;
};

export type RemoveAvatarCmd = { userId: string };

export type CleanupDeletedUserCmd = { userId: string; image: unknown };

export type CheckPasskeyDeletionCmd = {
  sessionCreatedAt: Date;
  passkeyCount: number;
};
