import { describe, expect, it } from "bun:test";
import { isErr } from "@nw-union/nw-utils/lib/rslt";
import { okAsync, unwrap, unwrapErr } from "../../../lib/rslt-test.ts";
import type { RandomPort } from "../../shared/port.ts";
import { mustUserId } from "../../shared/vo.test.ts";
import type { VideoItemDto } from "../api.ts";
import { convToVideoItemDto } from "../converter.ts";
import type { ContentRepositoryPort } from "../port.ts";
import type { Playlist, PlaylistVideo, StoredVideo } from "../type.ts";
import {
  buildHomeFeed,
  countUnwatchedNew,
  isNewVideo,
  newFeedWorkflow,
  pickRandomVideos,
  shuffle,
  validateJoinedAt,
  validateWatchedVideo,
} from "./feed.ts";

// ----------------------------------------------------------------------------
// Fake・テストデータ
// ----------------------------------------------------------------------------
// テストで使わないリポジトリのメソッド. 呼ばれたら失敗させる
const notUsed = (): never => {
  throw new Error("このテストでは使わない");
};

const unusedRepo: ContentRepositoryPort = {
  listPlaylists: notUsed,
  listPlaylistVideos: notUsed,
  listPlaylistVideoDates: notUsed,
  listWatchedIds: notUsed,
  listWatches: notUsed,
  listMembers: notUsed,
  insertWatch: notUsed,
  deleteWatch: notUsed,
  insertPlaylist: notUsed,
  deletePlaylist: notUsed,
  updatePlaylistInfo: notUsed,
  listVideoIds: notUsed,
  upsertVideos: notUsed,
  insertNewVideos: notUsed,
  listLinks: notUsed,
  deleteLinks: notUsed,
  upsertLinks: notUsed,
  insertLinks: notUsed,
  deleteOrphanVideos: notUsed,
};

const ID = "dQw4w9WgXcQ";

const newWatchFakes = () => {
  const inserted: [string, string][] = [];
  const deleted: [string, string][] = [];
  const repo: ContentRepositoryPort = {
    ...unusedRepo,
    insertWatch: (user, id) => {
      inserted.push([user, id]);
      return okAsync(undefined);
    },
    deleteWatch: (user, id) => {
      deleted.push([user, id]);
      return okAsync(undefined);
    },
  };
  return {
    wf: newFeedWorkflow(repo, random),
    inserted,
    deleted,
  };
};

const random: RandomPort = { bytes: (n) => new Uint8Array(n), float: () => 0 };

const row: PlaylistVideo = {
  playlistId: 1,
  video: {
    type: "StoredVideo",
    id: 1,
    youtubeId: ID,
    title: "動画",
    description: null,
    durationSeconds: 61,
    aspectRatio: 1,
    publishedAt: "2026-10-02T00:00:00Z",
    tags: ["tag"],
  },
};

const newFeedFakes = () => {
  const calls: string[] = [];
  const repo: ContentRepositoryPort = {
    ...unusedRepo,
    listPlaylists: () =>
      okAsync([
        {
          type: "Playlist",
          id: 1,
          playlistId: "PL1",
          name: "リスト",
          description: "説明",
        },
      ]),
    listPlaylistVideos: () => okAsync([row]),
    listPlaylistVideoDates: () => {
      calls.push("listPlaylistVideoDates");
      return okAsync([{ youtubeId: ID, publishedAt: row.video.publishedAt }]);
    },
    listWatchedIds: () => okAsync([ID]),
    listWatches: (users) => {
      calls.push(`listWatches:${users.join(",")}`);
      return okAsync([]);
    },
    listMembers: (users) => {
      calls.push(`listMembers:${users.join(",")}`);
      return okAsync(
        users.map((id) => ({ id, joinedAt: new Date("2026-10-01T00:00:00Z") })),
      );
    },
  };
  return {
    qs: newFeedWorkflow(repo, random),
    calls,
  };
};

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
// ワークフロー
// ----------------------------------------------------------------------------
describe("watch / unwatch", () => {
  it("検証した YouTube ID で, 視聴記録を入れる", async () => {
    // Arrange:
    const { wf, inserted } = newWatchFakes();

    // Act:
    const actual = await wf.watch({ userId: "user1", youtubeId: ID });

    // Assert:
    expect(isErr(actual)).toBeFalse();
    expect(inserted).toEqual([["user1", ID]]);
  });

  it("YouTube ID が不正な場合, ValidationError となり, 記録しない", async () => {
    // Arrange:
    const { wf, inserted } = newWatchFakes();

    // Act:
    const actual = await wf.watch({ userId: "user1", youtubeId: 1 });

    // Assert:
    expect(unwrapErr(actual).type).toBe("ValidationError");
    expect(inserted).toHaveLength(0);
  });

  it("視聴記録を消す", async () => {
    // Arrange:
    const { wf, deleted } = newWatchFakes();

    // Act:
    await wf.unwatch({ userId: "user1", youtubeId: ID });

    // Assert:
    expect(deleted).toEqual([["user1", ID]]);
  });
});

describe("getHomeFeed", () => {
  it("プレイリスト・動画・視聴記録から, ホームに並べる動画を組み立てる", async () => {
    // Act:
    const actual = await newFeedFakes().qs.getHomeFeed({
      userId: "user1",
      joinedAt: new Date("2026-10-01T00:00:00Z"),
    });

    // Assert:
    const feed = unwrap(actual);
    expect(feed.newVideos.map((v) => v.youtubeId)).toEqual([ID]);
    expect(feed.playlists).toHaveLength(1);
    expect(feed.playlists[0]).toMatchObject({
      name: "リスト",
      description: "説明",
    });
    expect(feed.playlists[0].videos[0]).toMatchObject({
      watched: true,
      duration: "1:01",
      aspectRatio: 1,
      tags: ["tag"],
    });
  });
});

describe("getBadgeCount", () => {
  it("そのユーザーの未視聴の New を数える", async () => {
    // Act:
    const actual = await newFeedFakes().qs.getBadgeCount({ userId: "user1" });

    // Assert:
    expect(unwrap(actual)).toEqual({ count: 1 });
  });
});

describe("countUnwatchedNew", () => {
  it("同じユーザーは 1 回だけ問い合わせる", async () => {
    // Arrange:
    const { qs, calls } = newFeedFakes();

    // Act:
    const actual = await qs.countUnwatchedNew({ userIds: ["a", "b", "a"] });

    // Assert:
    expect([...unwrap(actual).counts]).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(calls).toContain("listMembers:a,b");
  });

  it("ユーザーがいない場合, DB に問い合わせない", async () => {
    // Arrange:
    const { qs, calls } = newFeedFakes();

    // Act:
    const actual = await qs.countUnwatchedNew({ userIds: [] });

    // Assert:
    expect(unwrap(actual).counts.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// Step
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
// Step: バリデーション
// ----------------------------------------------------------------------------
describe("validateWatchedVideo", () => {
  it.each([
    ["短い", "abc"],
    ["空", undefined],
  ])("%s場合, ValidationError となる", (_, id) => {
    expect(unwrapErr(validateWatchedVideo(id)).issues).toEqual({
      youtubeId: ["動画の指定が正しくありません"],
    });
  });
});

describe("validateJoinedAt", () => {
  it("Date も ISO 8601 もミリ秒にする", () => {
    expect(unwrap(validateJoinedAt(new Date(JOINED)))).toBe(JOINED);
    expect(unwrap(validateJoinedAt("2026-10-01T00:00:00Z"))).toBe(JOINED);
  });

  it("読めない場合, ValidationError となる", () => {
    expect(isErr(validateJoinedAt("x"))).toBeTrue();
  });
});
