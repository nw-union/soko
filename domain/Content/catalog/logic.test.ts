import { describe, expect, it } from "bun:test";
import {
  canRemoveOrphans,
  extractHashtags,
  isDisplayable,
  parseEmbedAspectRatio,
  parseIsoDuration,
  planFullLinks,
  planNewLinks,
  playlistsToRename,
  toFetchedVideos,
  unknownVideoIds,
} from "./logic.ts";
import type { SyncPlaylist, YoutubeVideoItem } from "./type.ts";

// ----------------------------------------------------------------------------
// Test Data
// ----------------------------------------------------------------------------
const item = (over: Partial<YoutubeVideoItem> = {}): YoutubeVideoItem => ({
  id: "aaaaaaaaaaa",
  title: "動画",
  description: "",
  publishedAt: "2026-11-01T00:00:00Z",
  liveBroadcastContent: "none",
  duration: "PT1M",
  embedHtml: '<iframe width="480" height="270"></iframe>',
  privacyStatus: "public",
  embeddable: true,
  ...over,
});
const list = (id: number, over: Partial<SyncPlaylist> = {}): SyncPlaylist => ({
  id,
  playlistId: `PL${id}`,
  name: `リスト ${id}`,
  description: "",
  ...over,
});
const stored = [
  { id: 1, youtubeId: "a" },
  { id: 2, youtubeId: "b" },
  { id: 3, youtubeId: "c" },
];

// ----------------------------------------------------------------------------
// Validater
// ----------------------------------------------------------------------------
describe("extractHashtags", () => {
  it("行頭か空白の後ろのハッシュタグを, 出た順に拾う", () => {
    expect(extractHashtags("#ゲーム 実況 #Live\n#music")).toEqual([
      "ゲーム",
      "Live",
      "music",
    ]);
  });

  it("URL の # や, 数字だけのものは拾わない", () => {
    expect(extractHashtags("https://youtu.be/x#t=10 #123 #a1")).toEqual(["a1"]);
  });

  it("大文字小文字だけが違うものは, 先に出た方にまとめる", () => {
    expect(extractHashtags("#Game #game #GAME")).toEqual(["Game"]);
  });
});

describe("parseIsoDuration", () => {
  it.each([
    ["PT1H2M3S", 3723],
    ["PT45S", 45],
    ["PT10M", 600],
    ["P0D", null],
    ["PT0S", null],
    ["P1DT1H", null],
  ])("%s → %p", (iso, expected) => {
    expect(parseIsoDuration(iso)).toBe(expected);
  });
});

describe("parseEmbedAspectRatio", () => {
  it.each([
    ['<iframe width="480" height="270">', 1.778],
    ['<iframe width="480" height="480">', 1],
    ['<iframe width="480" height="1500">', null],
    ['<iframe width="0" height="270">', null],
    [undefined, null],
  ])("%s → %p", (html, expected) => {
    expect(parseEmbedAspectRatio(html)).toBe(expected);
  });
});

describe("isDisplayable", () => {
  it("公開・限定公開で, 埋め込みでき, 配信中でない動画は表示する", () => {
    expect(isDisplayable(item())).toBeTrue();
    expect(isDisplayable(item({ privacyStatus: "unlisted" }))).toBeTrue();
  });

  it.each([
    ["非公開", { privacyStatus: "private" }],
    ["埋め込み不可", { embeddable: false }],
    ["ライブ中", { liveBroadcastContent: "live" }],
    ["配信予定", { liveBroadcastContent: "upcoming" }],
  ])("%s の動画は表示しない", (_, over) => {
    expect(isDisplayable(item(over))).toBeFalse();
  });
});

describe("toFetchedVideos", () => {
  it("表示対象だけを, 長さ・縦横比・タグを読んだ形にする", () => {
    // Act:
    const actual = toFetchedVideos([
      item({ id: "x", duration: "PT1H2M3S", description: "説明 #tag" }),
      item({ id: "y", privacyStatus: "private" }),
    ]);

    // Assert:
    expect(actual).toEqual([
      {
        youtubeId: "x",
        title: "動画",
        description: "説明 #tag",
        durationSeconds: 3723,
        aspectRatio: 1.778,
        publishedAt: "2026-11-01T00:00:00Z",
        tags: ["tag"],
      },
    ]);
  });
});

// ----------------------------------------------------------------------------
// Domain Logic (全件の同期)
// ----------------------------------------------------------------------------
describe("playlistsToRename", () => {
  it("YouTube と名前・説明が違うプレイリストだけを返す. 返ってこなかったものは残す", () => {
    // Arrange:
    const lists = [
      list(1, { name: "同じ" }),
      list(2, { name: "古い名前" }),
      list(3),
      list(4, { name: "同じ", description: "古い説明" }),
    ];
    const infos = new Map([
      ["PL1", { title: "同じ", description: "" }],
      ["PL2", { title: "新しい名前", description: "" }],
      ["PL4", { title: "同じ", description: "新しい説明" }],
    ]);

    // Act:
    const actual = playlistsToRename(lists, infos);

    // Assert:
    expect(actual.map((r) => r.id)).toEqual([2, 4]);
  });
});

describe("planFullLinks", () => {
  it("取得できた動画だけを, プレイリストの順に詰めて結ぶ", () => {
    // Arrange: b は表示対象でない (取得できなかった)
    const idsByList = new Map([[1, ["c", "b", "a"]]]);

    // Act:
    const actual = planFullLinks(
      [list(1)],
      idsByList,
      stored,
      new Set(["a", "c"]),
      [],
    );

    // Assert:
    expect(actual.links).toEqual([
      { playlistId: 1, videoId: 3, position: 0 },
      { playlistId: 1, videoId: 1, position: 1 },
    ]);
  });

  it("同じ動画が 1 つのプレイリストに 2 回あれば, 最初の 1 回だけにする", () => {
    // Act:
    const actual = planFullLinks(
      [list(1)],
      new Map([[1, ["a", "b", "a"]]]),
      stored,
      new Set(["a", "b"]),
      [],
    );

    // Assert:
    expect(actual.links.map((l) => [l.videoId, l.position])).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it("プレイリストから外れた (または表示対象でなくなった) 動画の紐付けを外す", () => {
    // Arrange: 今は 1 に a・b・c, 2 に c. YouTube では 1 は a だけ, 2 は c のまま
    const current = [
      { playlistId: 1, videoId: 1, position: 0 },
      { playlistId: 1, videoId: 2, position: 1 },
      { playlistId: 1, videoId: 3, position: 2 },
      { playlistId: 2, videoId: 3, position: 0 },
    ];

    // Act:
    const actual = planFullLinks(
      [list(1), list(2)],
      new Map([
        [1, ["a", "b"]],
        [2, ["c"]],
      ]),
      stored,
      new Set(["a", "c"]),
      current,
    );

    // Assert:
    expect(actual.stale).toEqual([{ playlistId: 1, videoIds: [2, 3] }]);
  });
});

describe("canRemoveOrphans", () => {
  it("取得できた動画が 0 件なら, 消さない (API の異常で全部消さないように)", () => {
    expect(canRemoveOrphans([])).toBeFalse();
  });
});

// ----------------------------------------------------------------------------
// Domain Logic (差分の同期)
// ----------------------------------------------------------------------------
describe("unknownVideoIds", () => {
  it("DB にない動画の ID を, 重複なしで返す", () => {
    // Act:
    const actual = unknownVideoIds(
      new Map([
        [1, ["a", "x", "y"]],
        [2, ["x", "z"]],
      ]),
      stored,
    );

    // Assert:
    expect(actual).toEqual(["x", "y", "z"]);
  });
});

describe("planNewLinks", () => {
  it("足りない紐付けだけを, YouTube 上の位置で足す (既にある紐付けは変えない)", () => {
    // Arrange: 1 には a が既にある. b は新しく入った. x は DB にない (表示対象でない)
    const current = [{ playlistId: 1, videoId: 1 }];

    // Act:
    const actual = planNewLinks(
      [list(1), list(2)],
      new Map([
        [1, ["a", "x", "b"]],
        [2, ["a"]],
      ]),
      stored,
      current,
    );

    // Assert:
    expect(actual).toEqual([
      { playlistId: 1, videoId: 2, position: 2 },
      { playlistId: 2, videoId: 1, position: 0 },
    ]);
  });

  it("同じ動画が 1 つのプレイリストに 2 回あれば, 最初の位置で 1 回だけ足す", () => {
    expect(
      planNewLinks([list(1)], new Map([[1, ["b", "b"]]]), stored, []),
    ).toEqual([{ playlistId: 1, videoId: 2, position: 0 }]);
  });
});
