import { describe, expect, test } from "bun:test";
import { newContentWorkFlows } from "./workflow.ts";

describe("newContentWorkFlows", () => {
  test("Catalog と Feed の WorkFlow をまとめて返す", () => {
    const wf = newContentWorkFlows(
      {} as never,
      null,
      {} as never,
      (() => 0) as never,
    );
    expect(Object.keys(wf).sort()).toEqual(
      [
        "countUnwatchedNew",
        "getBadgeCount",
        "getHomeFeed",
        "syncAllVideos",
        "syncNewVideos",
        "unwatchVideo",
        "watchVideo",
      ].sort(),
    );
  });
});
