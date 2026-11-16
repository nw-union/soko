import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { runSyncNew } from "../../../server/process/sync.ts";

// デバッグ画面 (pages/debug.svelte) から, 差分の同期を今すぐ実行する. cron と同じ処理で, 結果のイベントを返す.
// /api/ はミドルウェアのログイン確認の対象外なので, ここで確かめる
export const POST = defineHandler(async (c) => {
  requireAuth(c);
  return runSyncNew();
});
