import { describe, expect, test } from "bun:test";
import type { NewSyncedEvt } from "../schema/service.ts";
import { onNewSynced } from "./policy.ts";

const run = async (evt: NewSyncedEvt) => {
  let called = 0;
  await onNewSynced(evt, async () => {
    called++;
  });
  return called;
};

describe("onNewSynced", () => {
  test("動画が増えたら通知する", async () => {
    expect(await run({ type: "Synced", added: 2, links: 3 })).toBe(1);
  });

  test("動画が増えていなければ通知しない（紐付けだけ増えた場合も）", async () => {
    expect(await run({ type: "Synced", added: 0, links: 0 })).toBe(0);
    expect(await run({ type: "Synced", added: 0, links: 1 })).toBe(0);
  });

  test("同期をスキップしたら通知しない", async () => {
    expect(await run({ type: "NoApiKey" })).toBe(0);
    expect(await run({ type: "NoPlaylists" })).toBe(0);
  });
});
