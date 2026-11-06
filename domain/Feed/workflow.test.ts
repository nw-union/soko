import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
import type { RandomPort } from "../port.ts";
import type { FeedRepositoryPort } from "./port.ts";
import type { PlaylistVideo } from "./type.ts";
import { newFeedWorkFlows } from "./workflow.ts";

// ----------------------------------------------------------------------------
// Test Data / Fake
// ----------------------------------------------------------------------------
const ID = "dQw4w9WgXcQ";
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

const newFakes = () => {
  const calls: string[] = [];
  const inserted: [string, string][] = [];
  const deleted: [string, string][] = [];
  const repo: FeedRepositoryPort = {
    listPlaylists: () =>
      okAsync([
        { type: "Playlist", id: 1, name: "リスト", description: "説明" },
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
    insertWatch: (user, id) => {
      inserted.push([user, id]);
      return okAsync(undefined);
    },
    deleteWatch: (user, id) => {
      deleted.push([user, id]);
      return okAsync(undefined);
    },
  };
  return { wf: newFeedWorkFlows(repo, random), calls, inserted, deleted };
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------
describe("getHomeFeed", () => {
  it("プレイリスト・動画・視聴記録から, ホームに並べる動画を組み立てる", async () => {
    // Act:
    const actual = await newFakes().wf.getHomeFeed({
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

describe("recordWatch / unrecordWatch", () => {
  it("検証した YouTube ID で, 視聴記録を入れる", async () => {
    // Arrange:
    const { wf, inserted } = newFakes();

    // Act:
    const actual = await wf.recordWatch({ userId: "user1", youtubeId: ID });

    // Assert:
    expect(actual.isOk()).toBeTrue();
    expect(inserted).toEqual([["user1", ID]]);
  });

  it("YouTube ID が不正な場合, ValidationError となり, 記録しない", async () => {
    // Arrange:
    const { wf, inserted } = newFakes();

    // Act:
    const actual = await wf.recordWatch({ userId: "user1", youtubeId: 1 });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
    expect(inserted).toHaveLength(0);
  });

  it("視聴記録を消す", async () => {
    // Arrange:
    const { wf, deleted } = newFakes();

    // Act:
    await wf.unrecordWatch({ userId: "user1", youtubeId: ID });

    // Assert:
    expect(deleted).toEqual([["user1", ID]]);
  });
});

describe("getBadgeCount", () => {
  it("そのユーザーの未視聴の New を数える", async () => {
    // Act:
    const actual = await newFakes().wf.getBadgeCount({ userId: "user1" });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ count: 1 });
  });
});

describe("countUnwatchedNew", () => {
  it("同じユーザーは 1 回だけ問い合わせる", async () => {
    // Arrange:
    const { wf, calls } = newFakes();

    // Act:
    const actual = await wf.countUnwatchedNew({ userIds: ["a", "b", "a"] });

    // Assert:
    expect([...actual._unsafeUnwrap().counts]).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(calls).toContain("listMembers:a,b");
  });

  it("ユーザーがいない場合, DB に問い合わせない", async () => {
    // Arrange:
    const { wf, calls } = newFakes();

    // Act:
    const actual = await wf.countUnwatchedNew({ userIds: [] });

    // Assert:
    expect(actual._unsafeUnwrap().counts.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
