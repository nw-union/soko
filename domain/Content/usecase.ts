import type { RandomPort } from "../shared/port.ts";
import type { ContentUsecase } from "./api.ts";
import type { ContentRepositoryPort, YoutubePort } from "./port.ts";
import { newFeedWorkflow } from "./workflow/feed.ts";
import { newPlaylistWorkflow } from "./workflow/playlist.ts";
import { newSyncWorkflow } from "./workflow/sync.ts";

/**
 * コンテンツ集約のユースケース. workflow/ のワークフローに依存を渡してまとめる
 *
 * @param yt - YouTube Data API. API キーが未設定なら null (同期しない)
 */
export const newContentUsecase = (
  r: ContentRepositoryPort,
  yt: YoutubePort | null,
  random: RandomPort,
): ContentUsecase => ({
  ...newSyncWorkflow(r, yt),
  ...newPlaylistWorkflow(r),
  ...newFeedWorkflow(r, random),
});
