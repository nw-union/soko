import { sql } from "void/db";
import { index, integer, primaryKey, sqliteTable, text } from "void/schema-d1";

// ホームに並べる YouTube 動画。サムネイルは youtube_id から URL を組み立てるので保存しない
export const videos = sqliteTable("videos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // YouTube の動画 ID（watch?v= の後ろの 11 文字）
  youtubeId: text("youtube_id").notNull().unique(),
  title: text("title").notNull(),
  // 動画の長さ（秒）。サムネイルの右下に表示する。わからなければ空（表示しない）
  durationSeconds: integer("duration_seconds"),
  // 概要欄。ポップアップに表示する。crons/sync-videos.ts が埋める
  description: text("description"),
  // 投稿日時（ISO 8601）。プレイリスト内の新着順に使う。crons/sync-videos.ts が埋める
  publishedAt: text("published_at"),
  // 概要欄のハッシュタグ（# なし）の JSON 配列。絞り込みに使う。crons/sync-videos.ts が埋める
  tags: text("tags").notNull().default("[]"),
  // 新着通知を送った（送らないと決めた）日時。空なら未通知。src/lib/push-notify.ts が埋める
  notifiedAt: text("notified_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// ユーザーごとの視聴記録。再生したとき・YouTube で開いたときに、routes/api/watches.ts が入れる。行がなければ未視聴。
// 動画は同期で消えて入り直すと id が変わるので、記録が残るよう youtube_id で持つ。ユーザー削除時は auth.ts で消す
export const videoWatches = sqliteTable(
  "video_watches",
  {
    userId: text("user_id").notNull(),
    youtubeId: text("youtube_id").notNull(),
    watchedAt: text("watched_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.youtubeId] })],
);

// 新着動画のプッシュ通知の購読。端末（ブラウザ）ごとに 1 行。endpoint は購読ごとに一意。
// 送れなくなった購読（404 / 410）は、送るときに消す。ユーザー削除時は auth.ts で消す
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // 購読したユーザーの ID（user.id）
    userId: text("user_id").notNull(),
    // プッシュサービス（FCM・APNs など）の URL
    endpoint: text("endpoint").notNull().unique(),
    // 暗号化に使う、端末の公開鍵と認証用の乱数（base64url）
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [index("push_subscriptions_user_idx").on(table.userId)],
);

// 動画を取得する YouTube のプレイリスト。crons/sync-videos.ts は、ここに登録されたプレイリストの動画を取得する
export const playlists = sqliteTable("playlists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // YouTube のプレイリスト ID（list= の後ろ。PL…）
  playlistId: text("playlist_id").notNull().unique(),
  // 管理用の名前（表示には使わない）
  name: text("name").notNull().default(""),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// プレイリストと動画の紐付け（多対多）。1 本の動画が複数のプレイリストに入っていてもよい。
// プレイリストごとの取得結果で、crons/sync-videos.ts が作り直す。どちらかが消えると、紐付けも消える
export const playlistVideos = sqliteTable(
  "playlist_videos",
  {
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    videoId: integer("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    // プレイリスト内での並び（YouTube 上の順、0 始まり）
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.playlistId, table.videoId] }),
    index("playlist_videos_video_idx").on(table.videoId),
  ],
);

// 招待。メンバーが発行し（1 人 3 回まで）、新規の人は「トークン」を入力して名前とパスキーを設定し、登録する。
// 名前は招待された人が登録時に決める。トークンそのものは保存せず、SHA-256 のハッシュだけを持つ
// （DB が見られても使えないように）。発行した本人にも、発行時に 1 回だけ表示する。
export const invites = sqliteTable("invites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(),
  // 発行したユーザーの ID（user.id）。管理者スクリプトで作った招待は空
  inviterUserId: text("inviter_user_id"),
  // この日時（UTC、"YYYY-MM-DD HH:MM:SS"）を過ぎると使えない。空なら無期限
  expiresAt: text("expires_at"),
  // 使われた日時。空でなければ使用済み（1 回だけ使える）
  usedAt: text("used_at"),
  // 使ったユーザーの ID（user.id）
  usedByUserId: text("used_by_user_id"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
