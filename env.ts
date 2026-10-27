import { defineEnv, string } from 'void/env';

// 動画の自動取得（crons/sync-videos.ts）用。未設定なら取得を行わないだけで、アプリは動く。
// 取得するプレイリストは、環境変数ではなく DB の playlists テーブルに登録する
export default defineEnv({
  YOUTUBE_API_KEY: string().optional(),
});
