// 動画を同期する cron（crons/sync-videos.ts・crons/sync-new-videos.ts）で共通に使うもの
import type { FetchedVideo } from "./youtube-api";

// D1 は 1 文のバインド変数が 100 個までなので、まとめて渡すときは分ける
export const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
};

// videos に入れる形。tags は JSON 配列の文字列にする
export const toVideoRow = ({ tags, ...video }: FetchedVideo) => ({
  ...video,
  tags: JSON.stringify(tags),
});
