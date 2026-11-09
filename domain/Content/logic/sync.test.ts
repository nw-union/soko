import { describe, expect, it } from "bun:test";
import type { Playlist } from "../type.ts";
import {
  canRemoveOrphans,
  planFullLinks,
  planNewLinks,
  playlistsToRename,
  unknownVideoIds,
} from "./sync.ts";

// ----------------------------------------------------------------------------
// Test Data
// ----------------------------------------------------------------------------
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
