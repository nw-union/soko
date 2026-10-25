import { sql } from "void/db";
import { integer, sqliteTable, text } from "void/schema-d1";

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
  // 投稿日時（ISO 8601）。同じ position の中での新着順に使う。crons/sync-videos.ts が埋める
  publishedAt: text("published_at"),
  // 概要欄のハッシュタグ（# なし）の JSON 配列。絞り込みに使う。crons/sync-videos.ts が埋める
  tags: text("tags").notNull().default("[]"),
  // 小さいほど先に表示する
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Explore ページの「SNS & Service」。アイコンは icon（discord など）のキーで選ぶ（src/lib/link-icons.ts）
export const socialLinks = sqliteTable("social_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  url: text("url").notNull().unique(),
  // アイコンのキー。未登録のキーは汎用の外部リンクのアイコンになる
  icon: text("icon").notNull().default("link"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Explore ページの「YouTube Playlist」。title・author・thumbnail は YouTube の oEmbed で調べられる
export const playlists = sqliteTable("playlists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  // チャンネル名
  author: text("author").notNull().default(""),
  url: text("url").notNull().unique(),
  // 正方形に切り取って表示するので、黒帯のない mqdefault.jpg を使う
  thumbnail: text("thumbnail").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Explore ページの「Podcast」。title・author・artwork は iTunes Search API で調べられる
export const podcasts = sqliteTable("podcasts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  author: text("author").notNull().default(""),
  url: text("url").notNull().unique(),
  // カバー画像（正方形）
  artwork: text("artwork").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

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
