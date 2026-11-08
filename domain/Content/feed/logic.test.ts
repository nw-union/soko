import { describe, expect, it } from "bun:test";
import type { VideoItemDto } from "../../../schema/service.ts";
import { mustUserId } from "../../vo.test.ts";
import {
  buildHomeFeed,
  convToVideoItemDto,
  countUnwatchedNew,
  formatPublishedAt,
  isNewVideo,
  pickRandomVideos,
  shuffle,
  validateJoinedAt,
  validateWatchedVideo,
} from "./logic.ts";
import type { Playlist, PlaylistVideo, StoredVideo } from "./type.ts";

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
