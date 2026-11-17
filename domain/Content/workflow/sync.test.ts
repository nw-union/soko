import { describe, expect, it } from "bun:test";
import { isErr } from "@nw-union/nw-utils/lib/rslt";
import {
  errAsync,
  okAsync,
  unwrap,
  unwrapErr,
} from "../../../lib/rslt-test.ts";
import { newDatabaseError } from "../../shared/error.ts";
import type { ContentRepositoryPort, YoutubePort } from "../port.ts";
import type {
  FetchedVideo,
  Link,
  Playlist,
  PlaylistInfo,
  StoredVideoId,
  YoutubeVideoItem,
} from "../type.ts";
import {
  canRemoveOrphans,
  extractHashtags,
  isDisplayable,
  newSyncWorkflow,
  parseEmbedAspectRatio,
  parseIsoDuration,
  planFullLinks,
  planNewLinks,
  playlistsToRename,
  toFetchedVideos,
  unknownVideoIds,
} from "./sync.ts";

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
    upsertedLinks: [] as Link[],
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
      db.upsertedLinks.push(...links);
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

const apiItem = (over: Partial<YoutubeVideoItem> = {}): YoutubeVideoItem => ({
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
// 共通
// ----------------------------------------------------------------------------
describe("API キー・プレイリストがない場合", () => {
  it("API キーがなければ, 何もしない", async () => {
    // Arrange:
    const { repo } = newSyncFakes({ remote: {} });

    // Act:
    const actual = await newSyncWorkflow(repo, null).syncAll();

    // Assert:
    expect(unwrap(actual)).toEqual({ type: "NoApiKey" });
  });

  it("プレイリストが登録されていなければ, 何もしない", async () => {
    // Arrange:
    const { repo, youtube } = newSyncFakes({ remote: {}, lists: [] });

    // Act:
    const actual = await newSyncWorkflow(repo, youtube).syncNew();

    // Assert:
    expect(unwrap(actual)).toEqual({ type: "NoPlaylists" });
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
    const actual = await newSyncWorkflow(repo, youtube).syncAll();

    // Assert:
    expect(unwrap(actual)).toEqual({
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

  it("並びが変わっていない紐付けは, 書き込まない", async () => {
    // Arrange: DB の紐付けは a・b の順のまま. YouTube の PL1 は [a, b, c]
    const { repo, youtube, db } = newSyncFakes({
      remote: { PL1: ["a", "b", "c"] },
      videos: [
        { id: 1, youtubeId: "a" },
        { id: 2, youtubeId: "b" },
      ],
      links: [
        { playlistId: 1, videoId: 1, position: 0 },
        { playlistId: 1, videoId: 2, position: 1 },
      ],
    });

    // Act:
    const actual = await newSyncWorkflow(repo, youtube).syncAll();

    // Assert: 書き込むのは新しい c の紐付けだけ. 反映した件数はすべて
    expect(unwrap(actual)).toMatchObject({ type: "Synced", links: 3 });
    expect(db.upsertedLinks).toEqual([
      { playlistId: 1, videoId: 3, position: 2 },
    ]);
  });

  it("プレイリストの名前と説明を, YouTube に合わせる", async () => {
    // Arrange:
    const { repo, youtube, db } = newSyncFakes({
      remote: { PL1: ["a"] },
      infos: { PL1: { title: "新しい名前", description: "説明" } },
    });

    // Act:
    const actual = await newSyncWorkflow(repo, youtube).syncAll();

    // Assert:
    expect(unwrap(actual)).toMatchObject({ renamed: 1 });
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
    const actual = await newSyncWorkflow(repo, youtube).syncAll();

    // Assert:
    expect(unwrap(actual)).toMatchObject({
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
    const actual = await newSyncWorkflow(repo, youtube).syncAll();

    // Assert:
    expect(isErr(actual)).toBeTrue();
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
    const actual = await newSyncWorkflow(repo, youtube).syncNew();

    // Assert:
    expect(unwrap(actual)).toEqual({
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
    const actual = await newSyncWorkflow(repo, youtube).syncNew();

    // Assert:
    expect(unwrap(actual)).toEqual({
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
    const actual = await newSyncWorkflow(repo, youtube).syncNew();

    // Assert:
    expect(unwrap(actual)).toEqual({
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
    const actual = await newSyncWorkflow(
      { ...repo, insertNewVideos: () => errAsync(newDatabaseError("boom")) },
      youtube,
    ).syncNew();

    // Assert:
    expect(unwrapErr(actual).type).toBe("DatabaseError");
  });
});

// ----------------------------------------------------------------------------
// Step: YouTube の値 → ドメインの型
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
    expect(isDisplayable(apiItem())).toBeTrue();
    expect(isDisplayable(apiItem({ privacyStatus: "unlisted" }))).toBeTrue();
  });

  it.each([
    ["非公開", { privacyStatus: "private" }],
    ["埋め込み不可", { embeddable: false }],
    ["ライブ中", { liveBroadcastContent: "live" }],
    ["配信予定", { liveBroadcastContent: "upcoming" }],
  ])("%s の動画は表示しない", (_, over) => {
    expect(isDisplayable(apiItem(over))).toBeFalse();
  });
});

describe("toFetchedVideos", () => {
  it("表示対象だけを, 長さ・縦横比・タグを読んだ形にする", () => {
    // Act:
    const actual = toFetchedVideos([
      apiItem({ id: "x", duration: "PT1H2M3S", description: "説明 #tag" }),
      apiItem({ id: "y", privacyStatus: "private" }),
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
// Step (全件の同期)
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
  it("changed は, 今の紐付けにないものと並びが変わったものだけ", () => {
    // Arrange: 今は 1 に a(0)・b(1). YouTube では 1 は [b, a, c]. 2 は a(0) のまま
    const current = [
      { playlistId: 1, videoId: 1, position: 0 },
      { playlistId: 1, videoId: 2, position: 1 },
      { playlistId: 2, videoId: 1, position: 0 },
    ];

    // Act:
    const actual = planFullLinks(
      [list(1), list(2)],
      new Map([
        [1, ["b", "a", "c"]],
        [2, ["a"]],
      ]),
      stored,
      new Set(["a", "b", "c"]),
      current,
    );

    // Assert:
    expect(actual.links).toHaveLength(4);
    expect(actual.changed).toEqual([
      { playlistId: 1, videoId: 2, position: 0 },
      { playlistId: 1, videoId: 1, position: 1 },
      { playlistId: 1, videoId: 3, position: 2 },
    ]);
  });
});

describe("canRemoveOrphans", () => {
  it("取得できた動画が 0 件なら, 消さない (API の異常で全部消さないように)", () => {
    expect(canRemoveOrphans([])).toBeFalse();
  });
});

// ----------------------------------------------------------------------------
// Step (差分の同期)
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
