import { defineEnv, string } from 'void/env';

// 動画の自動取得（crons/sync-videos.ts）用。未設定なら取得を行わないだけで、アプリは動く
export default defineEnv({
  YOUTUBE_API_KEY: string().optional(),
  YOUTUBE_PLAYLIST_ID: string().optional(),
});
