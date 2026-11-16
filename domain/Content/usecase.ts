import type { RandomPort } from "../shared/port.ts";
import type { ContentUsecase } from "./api.ts";
import type { ContentRepositoryPort, YoutubePort } from "./port.ts";
import { newContentQueries } from "./query.ts";
import { newContentWorkFlows } from "./workflow.ts";

/**
 * コンテンツ集約のユースケース. コマンド (workflow.ts) と Query (query.ts) をまとめる
 *
 * @param yt - YouTube Data API. API キーが未設定なら null (同期しない)
 */
export const newContentUsecase = (
  r: ContentRepositoryPort,
  yt: YoutubePort | null,
  random: RandomPort,
): ContentUsecase => ({
  ...newContentWorkFlows(r, yt),
  ...newContentQueries(r, random),
});
