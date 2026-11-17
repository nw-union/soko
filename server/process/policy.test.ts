import { describe, expect, test } from "bun:test";
import type { NewSyncedEvt } from "../../domain/Content/api.ts";
import type { MemberDeletedEvt } from "../../domain/Member/api.ts";
import { newDatabaseError } from "../../domain/shared/error.ts";
import { errAsync, okAsync } from "../../lib/rslt-test.ts";
import { onMemberDeleted, onNewSynced } from "./policy.ts";

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

describe("onMemberDeleted", () => {
  const evt: MemberDeletedEvt = { userId: "user1", image: null };

  test("すべての集約に, 退会したメンバーを渡して後始末させる", async () => {
    const received: string[] = [];
    const failures = await onMemberDeleted(evt, [
      (e) => {
        received.push(`member:${e.userId}`);
        return okAsync(undefined);
      },
      (e) => {
        received.push(`notification:${e.userId}`);
        return okAsync(undefined);
      },
    ]);
    expect(failures).toEqual([]);
    expect(received).toEqual(["member:user1", "notification:user1"]);
  });

  test("1 つが失敗しても残りは続け, 失敗をすべて返す", async () => {
    const received: string[] = [];
    const failures = await onMemberDeleted(evt, [
      () => errAsync(newDatabaseError("boom")),
      (e) => {
        received.push(e.userId);
        return okAsync(undefined);
      },
    ]);
    expect(failures.map((e) => e.type)).toEqual(["DatabaseError"]);
    expect(received).toEqual(["user1"]);
  });
});
