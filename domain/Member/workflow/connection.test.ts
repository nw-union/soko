import { describe, expect, it } from "bun:test";
import {
  errAsync,
  okAsync,
  unwrap,
  unwrapErr,
} from "../../../lib/rslt-test.ts";
import { newDatabaseError } from "../../shared/error.ts";
import { mustVo } from "../../shared/vo.ts";
import type { ConnectionRepositoryPort } from "../port.ts";
import type { ConnectedApp } from "../type.ts";
import { newOAuthClientId } from "../vo.ts";
import { newConnectionWorkflow } from "./connection.ts";

// ----------------------------------------------------------------------------
// Fake・テストデータ
// ----------------------------------------------------------------------------
const APP: ConnectedApp = {
  type: "ConnectedApp",
  clientId: mustVo(newOAuthClientId("client1")),
  name: "Claude",
  uri: "https://claude.ai",
  scopes: ["videos:read", "offline_access"],
  consentedAt: new Date("2026-11-01T00:00:00Z"),
  lastUsedAt: null,
};

const newFakes = (init: { fail?: boolean } = {}) => {
  const deleted: { user: string; client: string }[] = [];
  const repo: ConnectionRepositoryPort = {
    listConnectedApps: () =>
      init.fail ? errAsync(newDatabaseError("select")) : okAsync([APP]),
    deleteGrant: (user, client) => {
      deleted.push({ user, client });
      return init.fail
        ? errAsync(newDatabaseError("delete"))
        : okAsync(undefined);
    },
  };
  return { wf: newConnectionWorkflow(repo), deleted };
};

// ----------------------------------------------------------------------------
// revokeConnectedApp
// ----------------------------------------------------------------------------
describe("revokeConnectedApp", () => {
  it("本人の許可を消す", async () => {
    // Arrange:
    const { wf, deleted } = newFakes();

    // Act:
    const actual = await wf.revokeConnectedApp({
      userId: "user1",
      clientId: "client1",
    });

    // Assert:
    unwrap(actual);
    expect(deleted).toEqual([{ user: "user1", client: "client1" }]);
  });

  it.each([[""], [123], [undefined], ["x".repeat(256)]])(
    "クライアント ID が正しくなければ ValidationError で, 何も消さない (%p)",
    async (clientId) => {
      // Arrange:
      const { wf, deleted } = newFakes();

      // Act:
      const actual = await wf.revokeConnectedApp({ userId: "user1", clientId });

      // Assert:
      expect(unwrapErr(actual).type).toBe("ValidationError");
      expect(deleted).toEqual([]);
    },
  );

  it("DB のエラーはそのまま返す", async () => {
    const actual = await newFakes({ fail: true }).wf.revokeConnectedApp({
      userId: "user1",
      clientId: "client1",
    });
    expect(unwrapErr(actual).type).toBe("DatabaseError");
  });
});

// ----------------------------------------------------------------------------
// listConnectedApps
// ----------------------------------------------------------------------------
describe("listConnectedApps", () => {
  it("接続中のアプリを, 画面に出す形で返す", async () => {
    // Act:
    const actual = await newFakes().wf.listConnectedApps({ userId: "user1" });

    // Assert:
    expect(unwrap(actual)).toEqual({
      apps: [
        {
          clientId: "client1",
          name: "Claude",
          uri: "https://claude.ai",
          scopes: ["videos:read", "offline_access"],
          consentedAt: "2026-11-01T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
    });
  });

  it("ユーザー ID が空なら ValidationError", async () => {
    const actual = await newFakes().wf.listConnectedApps({ userId: "" });
    expect(unwrapErr(actual).type).toBe("ValidationError");
  });
});
