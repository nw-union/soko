import { describe, expect, it } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { newDatabaseError } from "../../error.ts";
import type { CatalogRepositoryPort, YoutubePort } from "./port.ts";
import type {
  FetchedVideo,
  Link,
  PlaylistInfo,
  StoredVideoId,
  SyncPlaylist,
  YoutubeVideoItem,
} from "./type.ts";
import { newCatalogWorkFlows } from "./workflow.ts";

// ----------------------------------------------------------------------------
// Fake: YouTube と DB をメモリ上で持つ
// ----------------------------------------------------------------------------
const item = (id: string, over: Partial<YoutubeVideoItem> = {}) => ({
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

const newFakes = (init: {
  // YouTube: プレイリスト ID → 動画 ID
  remote: Record<string, string[]>;
  infos?: Record<string, PlaylistInfo>;
  items?: YoutubeVideoItem[];
  // DB
  lists?: SyncPlaylist[];
  videos?: StoredVideoId[];
  links?: Link[];
  failInfos?: boolean;
}) => {
  const lists = init.lists ?? [
    { id: 1, playlistId: "PL1", name: "", description: "" },
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
        .map((id) => item(id))
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
  const repo: CatalogRepositoryPort = {
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
    const { repo } = newFakes({ remote: {} });

    // Act:
    const actual = await newCatalogWorkFlows(repo, null).syncAllVideos();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ type: "NoApiKey" });
  });

  it("プレイリストが登録されていなければ, 何もしない", async () => {
    // Arrange:
    const { repo, youtube } = newFakes({ remote: {}, lists: [] });

    // Act:
    const actual = await newCatalogWorkFlows(repo, youtube).syncNewVideos();

    // Assert:
    expect(actual._unsafeUnwrap()).toEqual({ type: "NoPlaylists" });
  });
});

// ----------------------------------------------------------------------------
// syncAllVideos
// ----------------------------------------------------------------------------
describe("syncAllVideos", () => {
  it("YouTube の通りに, 動画と紐付けを作り直し, 外れた動画を消す", async () => {
    // Arrange: DB には a・b・old があり, YouTube の PL1 は [b, c, a]. c は非公開
    const { repo, youtube, db } = newFakes({
      remote: { PL1: ["b", "c", "a"] },
      items: [item("a"), item("b"), item("c", { privacyStatus: "private" })],
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
    const actual = await newCatalogWorkFlows(repo, youtube).syncAllVideos();

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
    const { repo, youtube, db } = newFakes({
      remote: { PL1: ["a"] },
      infos: { PL1: { title: "新しい名前", description: "説明" } },
    });

    // Act:
    const actual = await newCatalogWorkFlows(repo, youtube).syncAllVideos();

    // Assert:
    expect(actual._unsafeUnwrap()).toMatchObject({ renamed: 1 });
    expect(db.renamed).toEqual([
      [1, { title: "新しい名前", description: "説明" }],
    ]);
  });

  it("取得できた動画が 0 件なら, 動画を消さない", async () => {
    // Arrange:
    const { repo, youtube, db } = newFakes({
      remote: { PL1: [] },
      videos: [{ id: 1, youtubeId: "a" }],
    });

    // Act:
    const actual = await newCatalogWorkFlows(repo, youtube).syncAllVideos();

    // Assert:
    expect(actual._unsafeUnwrap()).toMatchObject({
      removed: 0,
      removalSkipped: true,
    });
    expect(db.orphanCalls).toBe(0);
  });

  it("YouTube からの取得に失敗したら, DB は何も変えない", async () => {
    // Arrange:
    const { repo, youtube, db } = newFakes({
      remote: { PL1: ["a"] },
      failInfos: true,
    });

    // Act:
    const actual = await newCatalogWorkFlows(repo, youtube).syncAllVideos();

    // Assert:
    expect(actual.isErr()).toBeTrue();
    expect(db.upserted).toHaveLength(0);
    expect(db.links).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// syncNewVideos
// ----------------------------------------------------------------------------
describe("syncNewVideos", () => {
  it("DB にない動画だけ詳細を引いて足し, 紐付けを足す", async () => {
    // Arrange: a は既にあり紐付け済み. b が増えた
    const { repo, youtube, db, youtubeCalls } = newFakes({
      remote: { PL1: ["a", "b"] },
      videos: [{ id: 1, youtubeId: "a" }],
      links: [{ playlistId: 1, videoId: 1, position: 0 }],
    });

    // Act:
    const actual = await newCatalogWorkFlows(repo, youtube).syncNewVideos();

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
    const { repo, youtube, db, youtubeCalls } = newFakes({
      lists: [
        { id: 1, playlistId: "PL1", name: "", description: "" },
        { id: 2, playlistId: "PL2", name: "", description: "" },
      ],
      remote: { PL1: ["a"], PL2: ["a"] },
      videos: [{ id: 1, youtubeId: "a" }],
      links: [{ playlistId: 1, videoId: 1, position: 0 }],
    });

    // Act:
    const actual = await newCatalogWorkFlows(repo, youtube).syncNewVideos();

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
    const { repo, youtube, db } = newFakes({
      remote: { PL1: ["live"] },
      items: [item("live", { liveBroadcastContent: "live" })],
    });

    // Act:
    const actual = await newCatalogWorkFlows(repo, youtube).syncNewVideos();

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
    const { repo, youtube } = newFakes({ remote: { PL1: ["a"] } });

    // Act:
    const actual = await newCatalogWorkFlows(
      { ...repo, insertNewVideos: () => errAsync(newDatabaseError("boom")) },
      youtube,
    ).syncNewVideos();

    // Assert:
    expect(actual._unsafeUnwrapErr().type).toBe("DatabaseError");
  });
});
