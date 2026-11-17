import { describe, expect, test } from "bun:test";
import type { AllSyncedEvt, NewSyncedEvt } from "../../domain/Content/api.ts";
import { onVideosSynced } from "./policy.ts";

const run = async (evt: AllSyncedEvt | NewSyncedEvt) => {
  let called = 0;
  await onVideosSynced(evt, async () => {
    called++;
  });
  return called;
};

const allSynced = (addedVideoIds: string[]): AllSyncedEvt => ({
  type: "Synced",
  addedVideoIds,
  videos: 3,
  playlists: 1,
  links: 3,
  removed: 0,
  removalSkipped: false,
  renamed: 0,
});

describe("onVideosSynced", () => {
  test("差分の同期で動画が増えたら通知する", async () => {
    expect(
      await run({ type: "Synced", addedVideoIds: ["a", "b"], links: 3 }),
    ).toBe(1);
  });

  test("全件の同期で動画が増えたら通知する", async () => {
    expect(await run(allSynced(["a"]))).toBe(1);
  });

  test("動画が増えていなければ通知しない（紐付けだけ増えた場合も）", async () => {
    expect(await run({ type: "Synced", addedVideoIds: [], links: 0 })).toBe(0);
    expect(await run({ type: "Synced", addedVideoIds: [], links: 1 })).toBe(0);
    expect(await run(allSynced([]))).toBe(0);
  });

  test("同期をスキップしたら通知しない", async () => {
    expect(await run({ type: "NoApiKey" })).toBe(0);
    expect(await run({ type: "NoPlaylists" })).toBe(0);
  });
});
