import { defineEnv, oneOf, string } from "void/env";

// 動画の自動取得（crons/sync-videos.ts・crons/sync-new-videos.ts）用。未設定なら取得を行わないだけで、アプリは動く。
// 取得するプレイリストは、環境変数ではなく DB の playlists テーブルに登録する
export default defineEnv({
  // ログの出力先と最小レベル（@nw-union/nw-utils のロガー）。どちらも未設定なら json の info 以上。
  // json は Workers のログで構造化して見られる。console は色付きで、ローカルで読みやすい（.env に LOG_ADAPTER=console）
  LOG_ADAPTER: oneOf(["json", "console"]).optional(),
  LOG_LEVEL: oneOf(["debug", "info", "warn", "error"]).optional(),
  YOUTUBE_API_KEY: string().optional(),
  // 新着動画のプッシュ通知（Web Push の VAPID）用。scripts/generate-vapid-keys.mjs で作る。
  // どれかが未設定なら、通知は送らず、プロフィールにも通知の設定を出さない。
  // SUBJECT は連絡先（mailto:… か https://…）。プッシュサービス（Apple など）が問題のあるときに使う
  VAPID_PUBLIC_KEY: string().optional(),
  VAPID_PRIVATE_KEY: string().optional(),
  VAPID_SUBJECT: string().optional(),
});
