import { describe, expect, test } from "bun:test";
import type { Logger } from "@nw-union/nw-utils";
import { errAsync, okAsync } from "../../lib/rslt-test.ts";
import {
  newDatabaseError,
  newValidationErrorWithMessage,
} from "../../domain/shared/error.ts";
import type { McpPrincipal } from "./auth.ts";
import { handleMcpRequest } from "./handler.ts";
import { INTERNAL_MESSAGE } from "./result.ts";
import type { McpToolDeps } from "./tools.ts";

// ----------------------------------------------------------------------------
// Fake・テストデータ
// ----------------------------------------------------------------------------
const VIDEO = {
  id: 1,
  youtubeId: "dQw4w9WgXcQ",
  title: "動画",
  duration: "3:33",
  aspectRatio: 16 / 9,
  publishedAt: "2026.10.29",
  tags: ["tag"],
  watched: false,
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
};

const principal = (scopes: McpPrincipal["scopes"]): McpPrincipal => ({
  userId: "user1",
  joinedAt: "2026-01-01T00:00:00.000Z",
  clientId: "client1",
  scopes,
});

const ALL: McpPrincipal["scopes"] = [
  "videos:read",
  "watches:write",
  "playlists:write",
  "sync:run",
];

const newFakes = () => {
  const calls: { op: string; arg: unknown }[] = [];
  const logs: string[] = [];
  const rateLimits: string[] = [];
  const blocked = new Set<string>();
  const log = {
    debug: () => {},
    info: (m: string) => logs.push(`info ${m}`),
    warn: (m: string) => logs.push(`warn ${m}`),
    error: (m: string) => logs.push(`error ${m}`),
  } as unknown as Logger;
  const deps: McpToolDeps = {
    content: {
      getHomeFeed: (q) => {
        calls.push({ op: "getHomeFeed", arg: q });
        return okAsync({
          newVideos: Array.from({ length: 60 }, () => VIDEO),
          randomVideos: [],
          playlists: [{ id: 1, name: "P", description: "d", videos: [VIDEO] }],
        });
      },
      getVideoDetail: (q) => {
        calls.push({ op: "getVideoDetail", arg: q });
        return q.youtubeId === "broken"
          ? errAsync(newDatabaseError("select failed", new Error("boom")))
          : okAsync({ description: "概要" });
      },
      getBadgeCount: (q) => {
        calls.push({ op: "getBadgeCount", arg: q });
        return okAsync({ count: 3 });
      },
      listPlaylists: () => okAsync({ playlists: [] }),
      watch: (c) => {
        calls.push({ op: "watch", arg: c });
        return c.youtubeId === "bad"
          ? errAsync(
              newValidationErrorWithMessage(
                "youtubeId",
                "動画の ID の形が違います",
              ),
            )
          : okAsync(undefined);
      },
      unwatch: (c) => {
        calls.push({ op: "unwatch", arg: c });
        return okAsync(undefined);
      },
      createPlaylist: (c) => {
        calls.push({ op: "createPlaylist", arg: c });
        return okAsync({
          playlist: { id: 9, playlistId: c.playlistId, name: "" },
        });
      },
    },
    checkRateLimit: async (limit, subject) => {
      rateLimits.push(subject ? `${limit.name}:${subject}` : limit.name);
      return blocked.has(limit.name)
        ? { allowed: false, retryAfter: 120 }
        : { allowed: true };
    },
    syncNew: async () => {
      calls.push({ op: "syncNew", arg: null });
      return { type: "Synced", addedVideoIds: [], links: 0 };
    },
    log,
  };
  return { deps, calls, logs, rateLimits, blocked };
};

const rpc = async (
  p: McpPrincipal,
  deps: McpToolDeps,
  method: string,
  params: Record<string, unknown> = {},
) => {
  const res = await handleMcpRequest(
    new Request("https://soko.example/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    p,
    deps,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    result?: {
      tools?: { name: string }[];
      structuredContent?: Record<string, unknown>;
      content?: { text: string }[];
      isError?: boolean;
    };
    error?: { message: string };
  };
};

const call = (
  p: McpPrincipal,
  deps: McpToolDeps,
  name: string,
  args: Record<string, unknown> = {},
) => rpc(p, deps, "tools/call", { name, arguments: args });

// ----------------------------------------------------------------------------
// tools/list
// ----------------------------------------------------------------------------
describe("tools/list", () => {
  test("initialize に答える", async () => {
    const { deps } = newFakes();
    const res = await rpc(principal(ALL), deps, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(res.result).toMatchObject({ serverInfo: { name: "soko" } });
  });

  test("すべてのスコープなら, 公開するツールがすべて出る（消す操作は出ない）", async () => {
    const { deps } = newFakes();
    const res = await rpc(principal(ALL), deps, "tools/list");
    expect(res.result?.tools?.map((t) => t.name).sort()).toEqual(
      [
        "add_playlist",
        "get_home_feed",
        "get_unwatched_count",
        "get_video_detail",
        "list_playlists",
        "mark_unwatched",
        "mark_watched",
        "sync_new_videos",
      ].sort(),
    );
  });

  test("videos:read だけなら, 読み取りのツールだけが出る", async () => {
    const { deps } = newFakes();
    const res = await rpc(principal(["videos:read"]), deps, "tools/list");
    expect(res.result?.tools?.map((t) => t.name).sort()).toEqual(
      [
        "get_home_feed",
        "get_unwatched_count",
        "get_video_detail",
        "list_playlists",
      ].sort(),
    );
  });
});

// ----------------------------------------------------------------------------
// tools/call
// ----------------------------------------------------------------------------
describe("tools/call", () => {
  test("スコープのないツールは呼べない", async () => {
    const { deps, calls } = newFakes();
    const res = await call(principal(["videos:read"]), deps, "mark_watched", {
      youtubeId: "dQw4w9WgXcQ",
    });
    expect(res.result?.isError ?? !!res.error).toBeTrue();
    expect(calls).toEqual([]);
  });

  test("userId は引数ではなくトークンから決まる", async () => {
    const { deps, calls } = newFakes();
    await call(principal(ALL), deps, "mark_watched", {
      youtubeId: "dQw4w9WgXcQ",
      userId: "someone-else",
    });
    expect(calls).toEqual([
      { op: "watch", arg: { userId: "user1", youtubeId: "dQw4w9WgXcQ" } },
    ]);
  });

  test("get_home_feed: トークンの登録日時を使い, 一覧を 50 本に絞って余計な項目を落とす", async () => {
    const { deps, calls } = newFakes();
    const res = await call(principal(["videos:read"]), deps, "get_home_feed");
    expect(calls[0]).toEqual({
      op: "getHomeFeed",
      arg: { userId: "user1", joinedAt: "2026-01-01T00:00:00.000Z" },
    });
    const sc = res.result?.structuredContent as {
      newVideos: Record<string, unknown>[];
      newVideosTotal: number;
    };
    expect(sc.newVideos).toHaveLength(50);
    expect(sc.newVideosTotal).toBe(60);
    expect(Object.keys(sc.newVideos[0] ?? {}).sort()).toEqual(
      [
        "duration",
        "publishedAt",
        "tags",
        "title",
        "url",
        "watched",
        "youtubeId",
      ].sort(),
    );
  });

  test("get_unwatched_count: 自分の本数を返す", async () => {
    const { deps } = newFakes();
    const res = await call(
      principal(["videos:read"]),
      deps,
      "get_unwatched_count",
    );
    expect(res.result?.structuredContent).toEqual({ count: 3 });
  });

  test("入力の誤りは, ドメインの文言をツールのエラーにする", async () => {
    const { deps } = newFakes();
    const res = await call(principal(ALL), deps, "mark_watched", {
      youtubeId: "bad",
    });
    expect(res.result?.isError).toBeTrue();
    expect(res.result?.content?.[0]?.text).toBe("動画の ID の形が違います");
  });

  test("内部のエラーは中身を返さず, ログにだけ残す", async () => {
    const { deps, logs } = newFakes();
    const res = await call(principal(ALL), deps, "get_video_detail", {
      youtubeId: "broken",
    });
    expect(res.result?.isError).toBeTrue();
    expect(res.result?.content?.[0]?.text).toBe(INTERNAL_MESSAGE);
    expect(JSON.stringify(res)).not.toContain("select failed");
    expect(logs.some((l) => l.startsWith("error DatabaseError"))).toBeTrue();
  });

  test("add_playlist: 誰がどのアプリから追加したかをログに残す", async () => {
    const { deps, calls, logs } = newFakes();
    const res = await call(principal(ALL), deps, "add_playlist", {
      playlistId: "PLabc",
    });
    expect(res.result?.isError).toBeFalsy();
    expect(calls).toEqual([
      { op: "createPlaylist", arg: { playlistId: "PLabc" } },
    ]);
    expect(
      logs.some((l) => l.includes("add_playlist user=user1 client=client1")),
    ).toBeTrue();
  });

  test("sync_new_videos: 同期の結果を返す", async () => {
    const { deps } = newFakes();
    const res = await call(principal(ALL), deps, "sync_new_videos");
    expect(res.result?.structuredContent).toEqual({
      type: "Synced",
      addedVideoIds: [],
      links: 0,
    });
  });

  test("sync_new_videos: 失敗しても中身を返さない", async () => {
    const { deps } = newFakes();
    deps.syncNew = async () => {
      throw new Error("DatabaseError: secret detail");
    };
    const res = await call(principal(ALL), deps, "sync_new_videos");
    expect(res.result?.isError).toBeTrue();
    expect(JSON.stringify(res)).not.toContain("secret detail");
  });

  test("ツールを呼ぶたびに監査ログを残す（引数は残さない）", async () => {
    const { deps, logs } = newFakes();
    await call(principal(ALL), deps, "get_video_detail", {
      youtubeId: "dQw4w9WgXcQ",
    });
    const line = logs.find((l) => l.includes("tool=get_video_detail"));
    expect(line).toContain("user=user1 client=client1 ok=true");
    expect(line).not.toContain("dQw4w9WgXcQ");
  });

  test("add_playlist: 1 人あたりで数え, 上限を超えたら追加しない", async () => {
    const { deps, calls, rateLimits, blocked } = newFakes();
    await call(principal(ALL), deps, "add_playlist", { playlistId: "PLabc" });
    expect(rateLimits).toEqual(["mcp:add-playlist:user1"]);

    blocked.add("mcp:add-playlist");
    const res = await call(principal(ALL), deps, "add_playlist", {
      playlistId: "PLdef",
    });
    expect(res.result?.isError).toBeTrue();
    expect(res.result?.content?.[0]?.text).toContain("2 分ほど待って");
    expect(calls.filter((c) => c.op === "createPlaylist")).toHaveLength(1);
  });

  test("sync_new_videos: 全員で数え, 上限を超えたら同期しない", async () => {
    const { deps, calls, rateLimits, blocked } = newFakes();
    blocked.add("mcp:sync");
    const res = await call(principal(ALL), deps, "sync_new_videos");
    expect(rateLimits).toEqual(["mcp:sync"]);
    expect(res.result?.isError).toBeTrue();
    expect(calls).toEqual([]);
  });

  test("読み取りのツールは, ツールごとには数えない", async () => {
    const { deps, rateLimits } = newFakes();
    await call(principal(ALL), deps, "get_home_feed");
    expect(rateLimits).toEqual([]);
  });
});
