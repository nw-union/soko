import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
import type { RandomPort } from "../port.ts";
import type { ContentRepositoryPort } from "./port.ts";
import { newContentQueries } from "./query.ts";
import type { Playlist, PlaylistVideo } from "./type.ts";

// ----------------------------------------------------------------------------
// 共通の Fake
// ----------------------------------------------------------------------------
const random: RandomPort = { bytes: (n) => new Uint8Array(n), float: () => 0 };

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

// ----------------------------------------------------------------------------
// Test Data / Fake
// ----------------------------------------------------------------------------
const ID = "dQw4w9WgXcQ";

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
    q: newContentQueries(repo, random),
    calls,
  };
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------
describe("getHomeFeed", () => {
  it("プレイリスト・動画・視聴記録から, ホームに並べる動画を組み立てる", async () => {
    // Act:
    const actual = await newFeedFakes().q.getHomeFeed({
      userId: "user1",
      joinedAt: new Date("2026-10-01T00:00:00Z"),
    });

    // Assert:
    const feed = actual._unsafeUnwrap();
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
    const actual = await newFeedFakes().q.getBadgeCount({ userId: "user1" });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ count: 1 });
  });
});

describe("countUnwatchedNew", () => {
  it("同じユーザーは 1 回だけ問い合わせる", async () => {
    // Arrange:
    const { q, calls } = newFeedFakes();

    // Act:
    const actual = await q.countUnwatchedNew({ userIds: ["a", "b", "a"] });

    // Assert:
    expect([...actual._unsafeUnwrap().counts]).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(calls).toContain("listMembers:a,b");
  });

  it("ユーザーがいない場合, DB に問い合わせない", async () => {
    // Arrange:
    const { q, calls } = newFeedFakes();

    // Act:
    const actual = await q.countUnwatchedNew({ userIds: [] });

    // Assert:
    expect(actual._unsafeUnwrap().counts.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("listPlaylists", () => {
  const list: Playlist = {
    type: "Playlist",
    id: 7,
    playlistId: "PLabcdefghij",
    name: "",
    description: "",
  };

  it("一覧を DTO にして返す", async () => {
    const q = newContentQueries(
      { ...unusedRepo, listPlaylists: () => okAsync([list]) },
      random,
    );
    const actual = await q.listPlaylists();
    expect(actual._unsafeUnwrap()).toEqual({
      playlists: [{ id: 7, playlistId: "PLabcdefghij", name: "" }],
    });
  });
});
