// YouTube Data API v3 のクライアント。API の値をそのまま返す（表示対象かどうかは domain/Content/catalog が決める）
import { ResultAsync } from "neverthrow";
import type { YoutubePort } from "../../domain/Content/catalog/port.ts";
import type {
  PlaylistInfo,
  YoutubeVideoItem,
} from "../../domain/Content/catalog/type.ts";
import { type ExternalError, newExternalError } from "../../error.ts";

const API = "https://www.googleapis.com/youtube/v3";
// 1 回の問い合わせで渡せる ID の数
const PAGE = 50;

type VideoResource = {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    liveBroadcastContent: string;
  };
  contentDetails: { duration: string };
  player?: { embedHtml?: string };
  status: { privacyStatus: string; embeddable: boolean };
};

/**
 * @param key - API キー
 * @param fetcher - テストで差し替えるためのもの
 */
export const newYoutubeApi = (
  key: string,
  fetcher: typeof fetch = fetch,
): YoutubePort => {
  const call = <T>(
    path: string,
    params: Record<string, string>,
  ): ResultAsync<T, ExternalError> =>
    ResultAsync.fromPromise(
      (async () => {
        const res = await fetcher(
          `${API}/${path}?${new URLSearchParams({ ...params, key })}`,
        );
        if (!res.ok)
          throw new Error(
            `YouTube API ${path}: ${res.status} ${await res.text()}`,
          );
        return (await res.json()) as T;
      })(),
      (e) => newExternalError(`YouTube API ${path} に失敗しました`, e),
    );

  // ID を PAGE 件ずつに分けて, 順に問い合わせる
  const inPages = <T>(
    ids: string[],
    f: (page: string[]) => ResultAsync<T[], ExternalError>,
  ): ResultAsync<T[], ExternalError> => {
    let acc = ResultAsync.fromSafePromise<T[], ExternalError>(
      Promise.resolve([]),
    );
    for (let i = 0; i < ids.length; i += PAGE) {
      const page = ids.slice(i, i + PAGE);
      acc = acc.andThen((out) => f(page).map((items) => [...out, ...items]));
    }
    return acc;
  };

  return {
    fetchPlaylistVideoIds: (playlistId) => {
      const page = (
        pageToken: string | undefined,
        ids: string[],
      ): ResultAsync<string[], ExternalError> =>
        call<{
          items: { contentDetails: { videoId: string } }[];
          nextPageToken?: string;
        }>("playlistItems", {
          part: "contentDetails",
          playlistId,
          maxResults: String(PAGE),
          ...(pageToken ? { pageToken } : {}),
        }).andThen((res) => {
          const next = [
            ...ids,
            ...res.items.map((item) => item.contentDetails.videoId),
          ];
          return res.nextPageToken
            ? page(res.nextPageToken, next)
            : ResultAsync.fromSafePromise(Promise.resolve(next));
        });
      return page(undefined, []);
    },

    fetchPlaylistInfos: (playlistIds) =>
      inPages(playlistIds, (ids) =>
        call<{
          items?: {
            id: string;
            snippet: { title: string; description: string };
          }[];
        }>("playlists", {
          part: "snippet",
          id: ids.join(","),
          maxResults: String(PAGE),
        }).map((res) =>
          (res.items ?? []).map(
            (item) =>
              [
                item.id,
                {
                  title: item.snippet.title.trim(),
                  description: item.snippet.description.trim(),
                },
              ] as [string, PlaylistInfo],
          ),
        ),
      ).map((pairs) => new Map(pairs)),

    fetchVideoItems: (videoIds) =>
      inPages(videoIds, (ids) =>
        call<{ items: VideoResource[] }>("videos", {
          part: "snippet,contentDetails,status,player",
          id: ids.join(","),
        }).map((res) =>
          res.items.map(
            (item): YoutubeVideoItem => ({
              id: item.id,
              title: item.snippet.title,
              description: item.snippet.description,
              publishedAt: item.snippet.publishedAt,
              liveBroadcastContent: item.snippet.liveBroadcastContent,
              duration: item.contentDetails.duration,
              embedHtml: item.player?.embedHtml,
              privacyStatus: item.status.privacyStatus,
              embeddable: item.status.embeddable,
            }),
          ),
        ),
      ),
  };
};
