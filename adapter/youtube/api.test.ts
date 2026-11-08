import { describe, expect, it } from "bun:test";
import { newYoutubeApi } from "./api.ts";

// 呼ばれた URL を記録し, path ごとに決めた応答を返す fetch
const fakeFetch = (
  respond: (url: URL) => { status?: number; body: unknown },
) => {
  const calls: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const { status = 200, body } = respond(url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetcher, calls };
};

describe("fetchPlaylistVideoIds", () => {
  it("nextPageToken を辿って, 全ページの動画 ID を順に返す", async () => {
    // Arrange:
    const { fetcher, calls } = fakeFetch((url) =>
      url.searchParams.get("pageToken") === "p2"
        ? { body: { items: [{ contentDetails: { videoId: "c" } }] } }
        : {
            body: {
              items: [
                { contentDetails: { videoId: "a" } },
                { contentDetails: { videoId: "b" } },
              ],
              nextPageToken: "p2",
            },
          },
    );

    // Act:
    const actual = await newYoutubeApi("KEY", fetcher).fetchPlaylistVideoIds(
      "PL1",
    );

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual(["a", "b", "c"]);
    expect(calls.map((u) => u.pathname)).toEqual([
      "/youtube/v3/playlistItems",
      "/youtube/v3/playlistItems",
    ]);
    expect(calls[0].searchParams.get("key")).toBe("KEY");
    expect(calls[0].searchParams.get("playlistId")).toBe("PL1");
    expect(calls[0].searchParams.get("maxResults")).toBe("50");
  });

  it("API がエラーを返したら, ExternalError にする", async () => {
    // Arrange:
    const { fetcher } = fakeFetch(() => ({ status: 403, body: { error: 1 } }));

    // Act:
    const actual = await newYoutubeApi("KEY", fetcher).fetchPlaylistVideoIds(
      "PL1",
    );

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ExternalError");
  });
});

describe("fetchPlaylistInfos", () => {
  it("タイトルと説明の前後の空白を除く. 返ってこなかった ID は含めない", async () => {
    // Arrange:
    const { fetcher } = fakeFetch(() => ({
      body: {
        items: [
          { id: "PL1", snippet: { title: " 名前 ", description: "説明\n" } },
        ],
      },
    }));

    // Act:
    const actual = await newYoutubeApi("KEY", fetcher).fetchPlaylistInfos([
      "PL1",
      "PL2",
    ]);

    // Assert:
    expect([...actual._unsafeUnwrap()]).toEqual([
      ["PL1", { title: "名前", description: "説明" }],
    ]);
  });
});

describe("fetchVideoItems", () => {
  it("50 件ずつに分けて問い合わせ, API の値をそのまま返す", async () => {
    // Arrange:
    const ids = Array.from({ length: 51 }, (_, i) => `v${i}`);
    const { fetcher, calls } = fakeFetch((url) => ({
      body: {
        items: (url.searchParams.get("id") ?? "").split(",").map((id) => ({
          id,
          snippet: {
            title: id,
            description: "",
            publishedAt: "2026-11-01T00:00:00Z",
            liveBroadcastContent: "none",
          },
          contentDetails: { duration: "PT1M" },
          player: { embedHtml: "<iframe>" },
          status: { privacyStatus: "private", embeddable: false },
        })),
      },
    }));

    // Act:
    const actual = await newYoutubeApi("KEY", fetcher).fetchVideoItems(ids);

    // Assert:
    expect(
      calls.map((u) => u.searchParams.get("id")?.split(",").length),
    ).toEqual([50, 1]);
    expect(calls[0].searchParams.get("part")).toBe(
      "snippet,contentDetails,status,player",
    );
    const items = actual._unsafeUnwrap();
    expect(items).toHaveLength(51);
    // 非公開・埋め込み不可でも, ここでは除かない (ドメインが決める)
    expect(items[0]).toEqual({
      id: "v0",
      title: "v0",
      description: "",
      publishedAt: "2026-11-01T00:00:00Z",
      liveBroadcastContent: "none",
      duration: "PT1M",
      embedHtml: "<iframe>",
      privacyStatus: "private",
      embeddable: false,
    });
  });

  it("ID がなければ, 問い合わせない", async () => {
    // Arrange:
    const { fetcher, calls } = fakeFetch(() => ({ body: { items: [] } }));

    // Act:
    const actual = await newYoutubeApi("KEY", fetcher).fetchVideoItems([]);

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
