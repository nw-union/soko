import { describe, expect, it } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { newDatabaseError } from "../../error.ts";
import type { RandomPort } from "../port.ts";
import type { ContentRepositoryPort, YoutubePort } from "./port.ts";
import type {
  FetchedVideo,
  Link,
  Playlist,
  PlaylistInfo,
  PlaylistVideo,
  StoredVideoId,
  YoutubeVideoItem,
} from "./type.ts";
import { newContentWorkFlows } from "./workflow.ts";

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
  const inserted: [string, string][] = [];
  const deleted: [string, string][] = [];
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
    wf: newContentWorkFlows(repo, null, random),
    calls,
    inserted,
    deleted,
  };
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------
describe("getHomeFeed", () => {
  it("プレイリスト・動画・視聴記録から, ホームに並べる動画を組み立てる", async () => {
    // Act:
    const actual = await newFeedFakes().wf.getHomeFeed({
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

describe("watch / unwatch", () => {
  it("検証した YouTube ID で, 視聴記録を入れる", async () => {
    // Arrange:
    const { wf, inserted } = newFeedFakes();

    // Act:
    const actual = await wf.watch({ userId: "user1", youtubeId: ID });

    // Assert:
    expect(actual.isOk()).toBeTrue();
    expect(inserted).toEqual([["user1", ID]]);
  });

  it("YouTube ID が不正な場合, ValidationError となり, 記録しない", async () => {
    // Arrange:
    const { wf, inserted } = newFeedFakes();

    // Act:
    const actual = await wf.watch({ userId: "user1", youtubeId: 1 });

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("ValidationError");
    expect(inserted).toHaveLength(0);
  });

  it("視聴記録を消す", async () => {
    // Arrange:
    const { wf, deleted } = newFeedFakes();

    // Act:
    await wf.unwatch({ userId: "user1", youtubeId: ID });

    // Assert:
    expect(deleted).toEqual([["user1", ID]]);
  });
});

describe("getBadgeCount", () => {
  it("そのユーザーの未視聴の New を数える", async () => {
    // Act:
    const actual = await newFeedFakes().wf.getBadgeCount({ userId: "user1" });

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ count: 1 });
  });
});

describe("countUnwatchedNew", () => {
  it("同じユーザーは 1 回だけ問い合わせる", async () => {
    // Arrange:
    const { wf, calls } = newFeedFakes();

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
    const { wf, calls } = newFeedFakes();

    // Act:
    const actual = await wf.countUnwatchedNew({ userIds: [] });

    // Assert:
    expect(actual._unsafeUnwrap().counts.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// Fake: YouTube と DB をメモリ上で持つ
// ----------------------------------------------------------------------------
const ytItem = (id: string, over: Partial<YoutubeVideoItem> = {}) => ({
  id,
  title: `動画 ${id}`,
  description: "",
  publishedAt: "2026-11-01T00:00:00Z",
  liveBroadcastContent: "none",
  duration: "PT1M",
  embedHtml: undefined,
  privacyStatus: "public",
  embeddable: true,
  ...over,
});

const newSyncFakes = (init: {
  // YouTube: プレイリスト ID → 動画 ID
  remote: Record<string, string[]>;
  infos?: Record<string, PlaylistInfo>;
  items?: YoutubeVideoItem[];
  // DB
  lists?: Playlist[];
  videos?: StoredVideoId[];
  links?: Link[];
  failInfos?: boolean;
}) => {
  const lists = init.lists ?? [
    { type: "Playlist", id: 1, playlistId: "PL1", name: "", description: "" },
  ];
  let nextId = Math.max(0, ...(init.videos ?? []).map((v) => v.id)) + 1;
  const db = {
    videos: new Map((init.videos ?? []).map((v) => [v.youtubeId, v.id])),
    links: [...(init.links ?? [])],
    upserted: [] as FetchedVideo[],
    renamed: [] as [number, PlaylistInfo][],
    orphanCalls: 0,
  };
  const items = new Map(
    (
      init.items ??
      Object.values(init.remote)
        .flat()
        .map((id) => ytItem(id))
    ).map((i) => [i.id, i]),
  );
  const youtubeCalls: string[][] = [];

  const youtube: YoutubePort = {
    fetchPlaylistVideoIds: (id) => okAsync(init.remote[id] ?? []),
    fetchPlaylistInfos: (ids) =>
      init.failInfos
        ? errAsync(newDatabaseError("youtube down"))
        : okAsync(
            new Map(
              ids.flatMap((id) =>
                init.infos?.[id] ? [[id, init.infos[id]] as const] : [],
              ),
            ),
          ),
    fetchVideoItems: (ids) => {
      youtubeCalls.push(ids);
      return okAsync(ids.flatMap((id) => items.get(id) ?? []));
    },
  };
  const save = (videos: FetchedVideo[]) =>
    videos.flatMap((v) => {
      if (db.videos.has(v.youtubeId)) return [];
      db.videos.set(v.youtubeId, nextId++);
      return [{ id: db.videos.get(v.youtubeId) ?? 0, youtubeId: v.youtubeId }];
    });
  const repo: ContentRepositoryPort = {
    ...unusedRepo,
    listPlaylists: () => okAsync(lists),
    updatePlaylistInfo: (id, info) => {
      db.renamed.push([id, info]);
      return okAsync(undefined);
    },
    listVideoIds: () =>
      okAsync([...db.videos].map(([youtubeId, id]) => ({ id, youtubeId }))),
    upsertVideos: (videos) => {
      db.upserted.push(...videos);
      save(videos);
      return okAsync(undefined);
    },
    insertNewVideos: (videos) => okAsync(save(videos)),
    listLinks: () => okAsync([...db.links]),
    deleteLinks: ({ playlistId, videoIds }) => {
      db.links = db.links.filter(
        (l) => !(l.playlistId === playlistId && videoIds.includes(l.videoId)),
      );
      return okAsync(undefined);
    },
    upsertLinks: (links) => {
      for (const link of links) {
        db.links = db.links.filter(
          (l) =>
            !(l.playlistId === link.playlistId && l.videoId === link.videoId),
        );
        db.links.push(link);
      }
      return okAsync(undefined);
    },
    insertLinks: (links) => {
      db.links.push(...links);
      return okAsync(undefined);
    },
    deleteOrphanVideos: () => {
      db.orphanCalls++;
      const linked = new Set(db.links.map((l) => l.videoId));
      const orphans = [...db.videos].filter(([, id]) => !linked.has(id));
      for (const [youtubeId] of orphans) db.videos.delete(youtubeId);
      return okAsync(orphans.length);
    },
  };
  return { repo, youtube, db, youtubeCalls };
};

const sortLinks = (links: Link[]) =>
  [...links].sort(
    (a, b) => a.playlistId - b.playlistId || a.position - b.position,
  );

// ----------------------------------------------------------------------------
// 共通
// ----------------------------------------------------------------------------
describe("API キー・プレイリストがない場合", () => {
  it("API キーがなければ, 何もしない", async () => {
    // Arrange:
    const { repo } = newSyncFakes({ remote: {} });

    // Act:
    const actual = await newContentWorkFlows(repo, null, random).syncAll();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ type: "NoApiKey" });
  });

  it("プレイリストが登録されていなければ, 何もしない", async () => {
    // Arrange:
    const { repo, youtube } = newSyncFakes({ remote: {}, lists: [] });

    // Act:
    const actual = await newContentWorkFlows(repo, youtube, random).syncNew();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ type: "NoPlaylists" });
  });
});

// ----------------------------------------------------------------------------
// syncAll
// ----------------------------------------------------------------------------
describe("syncAll", () => {
  it("YouTube の通りに, 動画と紐付けを作り直し, 外れた動画を消す", async () => {
    // Arrange: DB には a・b・old があり, YouTube の PL1 は [b, c, a]. c は非公開
    const { repo, youtube, db } = newSyncFakes({
      remote: { PL1: ["b", "c", "a"] },
      items: [
        ytItem("a"),
        ytItem("b"),
        ytItem("c", { privacyStatus: "private" }),
      ],
      videos: [
        { id: 1, youtubeId: "a" },
        { id: 2, youtubeId: "b" },
        { id: 9, youtubeId: "old" },
      ],
      links: [
        { playlistId: 1, videoId: 1, position: 0 },
        { playlistId: 1, videoId: 9, position: 1 },
      ],
    });

    // Act:
    const actual = await newContentWorkFlows(repo, youtube, random).syncAll();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      type: "Synced",
      videos: 2,
      playlists: 1,
      links: 2,
      removed: 1,
      removalSkipped: false,
      renamed: 0,
    });
    expect(sortLinks(db.links)).toEqual([
      { playlistId: 1, videoId: 2, position: 0 },
      { playlistId: 1, videoId: 1, position: 1 },
    ]);
    expect([...db.videos.keys()].sort()).toEqual(["a", "b"]);
  });

  it("プレイリストの名前と説明を, YouTube に合わせる", async () => {
    // Arrange:
    const { repo, youtube, db } = newSyncFakes({
      remote: { PL1: ["a"] },
      infos: { PL1: { title: "新しい名前", description: "説明" } },
    });

    // Act:
    const actual = await newContentWorkFlows(repo, youtube, random).syncAll();

    // Assert:
    expect(actual._unsafeUnwrap()).toMatchObject({ renamed: 1 });
    expect(db.renamed).toEqual([
      [1, { title: "新しい名前", description: "説明" }],
    ]);
  });

  it("取得できた動画が 0 件なら, 動画を消さない", async () => {
    // Arrange:
    const { repo, youtube, db } = newSyncFakes({
      remote: { PL1: [] },
      videos: [{ id: 1, youtubeId: "a" }],
    });

    // Act:
    const actual = await newContentWorkFlows(repo, youtube, random).syncAll();

    // Assert:
    expect(actual._unsafeUnwrap()).toMatchObject({
      removed: 0,
      removalSkipped: true,
    });
    expect(db.orphanCalls).toBe(0);
  });

  it("YouTube からの取得に失敗したら, DB は何も変えない", async () => {
    // Arrange:
    const { repo, youtube, db } = newSyncFakes({
      remote: { PL1: ["a"] },
      failInfos: true,
    });

    // Act:
    const actual = await newContentWorkFlows(repo, youtube, random).syncAll();

    // Assert:
    expect(actual.isErr()).toBeTrue();
    expect(db.upserted).toHaveLength(0);
    expect(db.links).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// syncNew
// ----------------------------------------------------------------------------
describe("syncNew", () => {
  it("DB にない動画だけ詳細を引いて足し, 紐付けを足す", async () => {
    // Arrange: a は既にあり紐付け済み. b が増えた
    const { repo, youtube, db, youtubeCalls } = newSyncFakes({
      remote: { PL1: ["a", "b"] },
      videos: [{ id: 1, youtubeId: "a" }],
      links: [{ playlistId: 1, videoId: 1, position: 0 }],
    });

    // Act:
    const actual = await newContentWorkFlows(repo, youtube, random).syncNew();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      type: "Synced",
      added: 1,
      links: 1,
    });
    expect(youtubeCalls).toEqual([["b"]]);
    expect(sortLinks(db.links)).toEqual([
      { playlistId: 1, videoId: 1, position: 0 },
      { playlistId: 1, videoId: 2, position: 1 },
    ]);
  });

  it("既にある動画が別のプレイリストに入ったときも, 紐付けを足す (詳細は引かない)", async () => {
    // Arrange:
    const { repo, youtube, db, youtubeCalls } = newSyncFakes({
      lists: [
        {
          type: "Playlist",
          id: 1,
          playlistId: "PL1",
          name: "",
          description: "",
        },
        {
          type: "Playlist",
          id: 2,
          playlistId: "PL2",
          name: "",
          description: "",
        },
      ],
      remote: { PL1: ["a"], PL2: ["a"] },
      videos: [{ id: 1, youtubeId: "a" }],
      links: [{ playlistId: 1, videoId: 1, position: 0 }],
    });

    // Act:
    const actual = await newContentWorkFlows(repo, youtube, random).syncNew();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      type: "Synced",
      added: 0,
      links: 1,
    });
    expect(youtubeCalls).toHaveLength(0);
    expect(db.links).toContainEqual({ playlistId: 2, videoId: 1, position: 0 });
  });

  it("表示対象でない新しい動画は, 足さない", async () => {
    // Arrange:
    const { repo, youtube, db } = newSyncFakes({
      remote: { PL1: ["live"] },
      items: [ytItem("live", { liveBroadcastContent: "live" })],
    });

    // Act:
    const actual = await newContentWorkFlows(repo, youtube, random).syncNew();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({
      type: "Synced",
      added: 0,
      links: 0,
    });
    expect(db.videos.size).toBe(0);
  });

  it("DB エラーの場合, DatabaseError を返す", async () => {
    // Arrange:
    const { repo, youtube } = newSyncFakes({ remote: { PL1: ["a"] } });

    // Act:
    const actual = await newContentWorkFlows(
      { ...repo, insertNewVideos: () => errAsync(newDatabaseError("boom")) },
      youtube,
      random,
    ).syncNew();

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("DatabaseError");
  });
});
