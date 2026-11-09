import { describe, expect, it } from "bun:test";
import { mustUserId } from "../shared/vo.test.ts";
import type { VideoItemDto } from "./api.ts";
import {
  buildHomeFeed,
  canRemoveOrphans,
  convToVideoItemDto,
  countUnwatchedNew,
  extractHashtags,
  formatPublishedAt,
  isDisplayable,
  isNewVideo,
  parseEmbedAspectRatio,
  parseIsoDuration,
  pickRandomVideos,
  planFullLinks,
  planNewLinks,
  playlistsToRename,
  shuffle,
  toFetchedVideos,
  unknownVideoIds,
  validateJoinedAt,
  validateWatchedVideo,
} from "./logic.ts";
import type {
  Playlist,
  PlaylistVideo,
  StoredVideo,
  YoutubeVideoItem,
} from "./type.ts";

// ----------------------------------------------------------------------------
// Test Data
// ----------------------------------------------------------------------------
const JOINED = Date.parse("2026-10-01T00:00:00Z");
// 乱数を固定する (0 なら, シャッフルは毎回 先頭を末尾に送る並べ替えになる)
const zero = () => 0;

const video = (id: number, over: Partial<StoredVideo> = {}): StoredVideo => ({
  type: "StoredVideo",
  id,
  youtubeId: `video${String(id).padStart(6, "0")}`,
  title: `動画 ${id}`,
  description: null,
  durationSeconds: null,
  aspectRatio: null,
  publishedAt: "2026-09-01T00:00:00Z",
  tags: [],
  ...over,
});
const playlist = (id: number): Playlist => ({
  type: "Playlist",
  id,
  playlistId: `PL${id}`,
  name: `リスト ${id}`,
  description: "",
});
const item = (id: number, watched = false): VideoItemDto =>
  convToVideoItemDto(video(id), watched);

// ----------------------------------------------------------------------------
// Domain Logic
// ----------------------------------------------------------------------------
describe("isNewVideo", () => {
  it("登録以降に投稿された動画は New", () => {
    expect(isNewVideo("2026-10-01T00:00:00Z", JOINED)).toBeTrue();
  });

  it("登録より前に投稿された動画は New でない", () => {
    expect(isNewVideo("2026-09-30T23:59:59Z", JOINED)).toBeFalse();
  });

  it("投稿日時のない動画は New でない", () => {
    expect(isNewVideo(null, JOINED)).toBeFalse();
  });
});

describe("shuffle", () => {
  it("元の配列を変えず, 同じ要素を並べ替えたものを返す", () => {
    // Arrange:
    const items = [1, 2, 3, 4];
    let n = 0;
    const random = () => [0.9, 0.1, 0.5][n++ % 3];

    // Act:
    const actual = shuffle(items, random);

    // Assert:
    expect(items).toEqual([1, 2, 3, 4]);
    expect([...actual].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("pickRandomVideos", () => {
  it("未視聴の New は除く (New の欄に出るため)", () => {
    // Arrange:
    const items = [item(1), item(2), item(3)];

    // Act:
    const actual = pickRandomVideos(items, [item(1)], zero);

    // Assert:
    expect(actual.map((v) => v.id).sort()).toEqual([2, 3]);
  });

  it("見た New は, 候補に入れる", () => {
    // Act:
    const actual = pickRandomVideos([item(1, true)], [item(1, true)], zero);

    // Assert:
    expect(actual.map((v) => v.id)).toEqual([1]);
  });

  it("候補の 9 本から, 未視聴を優先して 3 本選ぶ", () => {
    // Arrange: 未視聴は 10〜11 の 2 本だけ
    const items = [
      ...Array.from({ length: 7 }, (_, i) => item(i + 1, true)),
      item(10),
      item(11),
    ];

    // Act:
    const actual = pickRandomVideos(items, [], zero);

    // Assert:
    expect(actual).toHaveLength(3);
    expect(
      actual
        .filter((v) => !v.watched)
        .map((v) => v.id)
        .sort(),
    ).toEqual([10, 11]);
  });
});

describe("buildHomeFeed", () => {
  it("New の候補は, 登録以降に投稿された動画 (新しい順のまま)", () => {
    // Arrange:
    const rows: PlaylistVideo[] = [
      {
        playlistId: 1,
        video: video(2, { publishedAt: "2026-10-03T00:00:00Z" }),
      },
      {
        playlistId: 1,
        video: video(1, { publishedAt: "2026-10-02T00:00:00Z" }),
      },
      { playlistId: 1, video: video(3) },
    ];

    // Act:
    const actual = buildHomeFeed([playlist(1)], rows, new Set(), JOINED, zero);

    // Assert:
    expect(actual.newVideos.map((v) => v.id)).toEqual([2, 1]);
  });

  it("複数のプレイリストに入っている動画は, New とランダムでは 1 本にまとめる", () => {
    // Arrange:
    const v = video(1, { publishedAt: "2026-10-02T00:00:00Z" });
    const rows: PlaylistVideo[] = [
      { playlistId: 1, video: v },
      { playlistId: 2, video: v },
    ];

    // Act:
    const actual = buildHomeFeed(
      [playlist(1), playlist(2)],
      rows,
      new Set([v.youtubeId]),
      JOINED,
      zero,
    );

    // Assert:
    expect(actual.newVideos).toHaveLength(1);
    expect(actual.randomVideos).toHaveLength(1);
    expect(actual.playlists.map((l) => l.videos.length)).toEqual([1, 1]);
  });

  it("プレイリストは並び順のまま, 動画のないプレイリストは出さない", () => {
    // Arrange:
    const rows: PlaylistVideo[] = [
      { playlistId: 3, video: video(1) },
      { playlistId: 1, video: video(2) },
    ];

    // Act:
    const actual = buildHomeFeed(
      [playlist(3), playlist(2), playlist(1)],
      rows,
      new Set(),
      JOINED,
      zero,
    );

    // Assert:
    expect(actual.playlists.map((l) => l.id)).toEqual([3, 1]);
  });

  it("不正な YouTube ID の動画は, どこにも出さない", () => {
    // Arrange:
    const rows: PlaylistVideo[] = [
      { playlistId: 1, video: video(1, { youtubeId: "bad<id>" }) },
    ];

    // Act:
    const actual = buildHomeFeed([playlist(1)], rows, new Set(), JOINED, zero);

    // Assert:
    expect(actual).toEqual({ newVideos: [], randomVideos: [], playlists: [] });
  });

  it("見た動画には watched を付ける", () => {
    // Arrange:
    const v = video(1);

    // Act:
    const actual = buildHomeFeed(
      [playlist(1)],
      [{ playlistId: 1, video: v }],
      new Set([v.youtubeId]),
      JOINED,
      zero,
    );

    // Assert:
    expect(actual.playlists[0].videos[0].watched).toBeTrue();
  });
});

describe("countUnwatchedNew", () => {
  it("ユーザーごとに, 登録以降に投稿された未視聴の動画を数える", () => {
    // Arrange:
    const members = [
      { id: mustUserId("old"), joinedAt: new Date("2026-01-01T00:00:00Z") },
      { id: mustUserId("new"), joinedAt: new Date("2026-10-01T00:00:00Z") },
    ];
    const videos = [
      { youtubeId: "aaaaaaaaaaa", publishedAt: "2026-09-01T00:00:00Z" },
      { youtubeId: "bbbbbbbbbbb", publishedAt: "2026-10-02T00:00:00Z" },
      { youtubeId: "bad", publishedAt: "2026-10-02T00:00:00Z" },
    ];
    const watches = [{ userId: "old", youtubeId: "bbbbbbbbbbb" }];

    // Act:
    const actual = countUnwatchedNew(members, videos, watches);

    // Assert: old は 2 本のうち 1 本を見た. new は登録後の 1 本だけ. 不正な ID は数えない
    expect([...actual]).toEqual([
      ["old", 1],
      ["new", 1],
    ]);
  });
});

// ----------------------------------------------------------------------------
// Validater
// ----------------------------------------------------------------------------
describe("validateWatchedVideo", () => {
  it.each([
    ["短い", "abc"],
    ["空", undefined],
  ])("%s場合, ValidationError となる", (_, id) => {
    expect(validateWatchedVideo(id)._unsafeUnwrapErr().issues).toEqual({
      youtubeId: ["動画の指定が正しくありません"],
    });
  });
});

describe("validateJoinedAt", () => {
  it("Date も ISO 8601 もミリ秒にする", () => {
    expect(validateJoinedAt(new Date(JOINED))._unsafeUnwrap()).toBe(JOINED);
    expect(validateJoinedAt("2026-10-01T00:00:00Z")._unsafeUnwrap()).toBe(
      JOINED,
    );
  });

  it("読めない場合, ValidationError となる", () => {
    expect(validateJoinedAt("x").isErr()).toBeTrue();
  });
});

// ----------------------------------------------------------------------------
// Converter
// ----------------------------------------------------------------------------
describe("formatPublishedAt", () => {
  it("日本時間の日付にする (UTC では前の日でも)", () => {
    expect(formatPublishedAt("2026-10-28T15:00:00Z")).toBe("2026.10.29");
  });

  it.each([
    ["ない", null],
    ["読めない", "x"],
  ])("%s場合, null にする", (_, iso) => {
    expect(formatPublishedAt(iso)).toBeNull();
  });
});

describe("convToVideoItemDto", () => {
  it("長さ・縦横比・概要欄がない動画は, 既定の値にする", () => {
    // Act:
    const actual = convToVideoItemDto(video(1), false);

    // Assert:
    expect(actual).toMatchObject({
      duration: null,
      aspectRatio: 16 / 9,
      description: "",
    });
  });

  it("長さと URL を組み立てる", () => {
    // Act:
    const actual = convToVideoItemDto(
      video(1, { youtubeId: "dQw4w9WgXcQ", durationSeconds: 3723 }),
      true,
    );

    // Assert:
    expect(actual).toMatchObject({
      duration: "1:02:03",
      watched: true,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    });
  });
});

// ----------------------------------------------------------------------------
// Test Data
// ----------------------------------------------------------------------------
const ytItem = (over: Partial<YoutubeVideoItem> = {}): YoutubeVideoItem => ({
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
const list = (id: number, over: Partial<Playlist> = {}): Playlist => ({
  type: "Playlist",
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
    expect(isDisplayable(ytItem())).toBeTrue();
    expect(isDisplayable(ytItem({ privacyStatus: "unlisted" }))).toBeTrue();
  });

  it.each([
    ["非公開", { privacyStatus: "private" }],
    ["埋め込み不可", { embeddable: false }],
    ["ライブ中", { liveBroadcastContent: "live" }],
    ["配信予定", { liveBroadcastContent: "upcoming" }],
  ])("%s の動画は表示しない", (_, over) => {
    expect(isDisplayable(ytItem(over))).toBeFalse();
  });
});

describe("toFetchedVideos", () => {
  it("表示対象だけを, 長さ・縦横比・タグを読んだ形にする", () => {
    // Act:
    const actual = toFetchedVideos([
      ytItem({ id: "x", duration: "PT1H2M3S", description: "説明 #tag" }),
      ytItem({ id: "y", privacyStatus: "private" }),
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
