import type { ContentWorkFlows } from "../../schema/service.ts";
import type { RandomPort } from "../port.ts";
import type { CatalogRepositoryPort, YoutubePort } from "./catalog/port.ts";
import { newCatalogWorkFlows } from "./catalog/workflow.ts";
import type { FeedRepositoryPort } from "./feed/port.ts";
import { newFeedWorkFlows } from "./feed/workflow.ts";

/**
 * コンテンツ集約の WorkFlows. 動画を取り込む Catalog と、見る・記録する Feed をまとめる
 *
 * @param yt - YouTube Data API. API キーが未設定なら null (同期しない)
 */
export const newContentWorkFlows = (
  catalog: CatalogRepositoryPort,
  yt: YoutubePort | null,
  feed: FeedRepositoryPort,
  random: RandomPort,
): ContentWorkFlows => ({
  ...newCatalogWorkFlows(catalog, yt),
  ...newFeedWorkFlows(feed, random),
});
