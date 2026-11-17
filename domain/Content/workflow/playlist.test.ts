import { describe, expect, it } from "bun:test";
import { isErr } from "@nw-union/nw-utils/lib/rslt";
import { okAsync, unwrap, unwrapErr } from "../../../lib/rslt-test.ts";
import type { ContentRepositoryPort } from "../port.ts";
import type { Playlist } from "../type.ts";
import { newPlaylistWorkflow } from "./playlist.ts";

// ----------------------------------------------------------------------------
// Fake・テストデータ
// ----------------------------------------------------------------------------
// テストで使わないリポジトリのメソッド. 呼ばれたら失敗させる
const notUsed = (): never => {
  throw new Error("このテストでは使わない");
};

const unusedRepo: ContentRepositoryPort = {
  listPlaylists: notUsed,
  loadHomeFeed: notUsed,
  findVideoDescription: notUsed,
  listPlaylistVideoDates: notUsed,
  listWatches: notUsed,
  listMembers: notUsed,
  insertWatch: notUsed,
  deleteWatch: notUsed,
  deleteWatches: notUsed,
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

describe("プレイリストの管理", () => {
  const list: Playlist = {
    type: "Playlist",
    id: 7,
    playlistId: "PLabcdefghij",
    name: "",
    description: "",
  };

  it("createPlaylist: 登録できたら DTO を返す", async () => {
    const saved: string[] = [];
    const wf = newPlaylistWorkflow({
      ...unusedRepo,
      insertPlaylist: (id) => {
        saved.push(id);
        return okAsync(list);
      },
    });
    const actual = await wf.createPlaylist({ playlistId: "PLabcdefghij" });
    expect(unwrap(actual).playlist.id).toBe(7);
    expect(saved).toEqual(["PLabcdefghij"]);
  });

  it("createPlaylist: 既にあれば ConflictError", async () => {
    const wf = newPlaylistWorkflow({
      ...unusedRepo,
      insertPlaylist: () => okAsync(null),
    });
    const actual = await wf.createPlaylist({ playlistId: "PLabcdefghij" });
    expect(unwrapErr(actual).type).toBe("ConflictError");
  });

  it("createPlaylist: 不正な ID なら ValidationError で, DB に触らない", async () => {
    const wf = newPlaylistWorkflow(unusedRepo);
    const actual = await wf.createPlaylist({ playlistId: "x" });
    expect(unwrapErr(actual).type).toBe("ValidationError");
  });

  it("deletePlaylist: 消す", async () => {
    const deleted: number[] = [];
    const wf = newPlaylistWorkflow({
      ...unusedRepo,
      deletePlaylist: (id) => {
        deleted.push(id);
        return okAsync(undefined);
      },
    });
    const actual = await wf.deletePlaylist({ id: "7" });
    expect(isErr(actual)).toBeFalse();
    expect(deleted).toEqual([7]);
  });

  it("deletePlaylist: id が不正なら ValidationError", async () => {
    const wf = newPlaylistWorkflow(unusedRepo);
    const actual = await wf.deletePlaylist({ id: "-1" });
    expect(unwrapErr(actual).type).toBe("ValidationError");
  });

  it.each(["", "abc", "1.5"])(
    "deletePlaylist: id が %p なら ValidationError",
    async (id) => {
      const wf = newPlaylistWorkflow(unusedRepo);
      const actual = await wf.deletePlaylist({ id });
      expect(unwrapErr(actual).type).toBe("ValidationError");
    },
  );
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
    const qs = newPlaylistWorkflow({
      ...unusedRepo,
      listPlaylists: () => okAsync([list]),
    });
    const actual = await qs.listPlaylists();
    expect(unwrap(actual)).toEqual({
      playlists: [{ id: 7, playlistId: "PLabcdefghij", name: "" }],
    });
  });
});
