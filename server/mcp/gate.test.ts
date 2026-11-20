import { describe, expect, test } from "bun:test";
import type { Logger } from "@nw-union/nw-utils";
import { errAsync, okAsync } from "../../lib/rslt-test.ts";
import { newDatabaseError } from "../../domain/shared/error.ts";
import type { McpPrincipal } from "./auth.ts";
import { type GateRequest, gateMcpRequest } from "./gate.ts";

const ORIGIN = "https://soko.example";
const PRINCIPAL: McpPrincipal = {
  userId: "user1",
  joinedAt: "2026-01-01T00:00:00.000Z",
  clientId: "client1",
  scopes: ["videos:read"],
};

const request = (over: Partial<GateRequest> = {}): GateRequest => ({
  origin: ORIGIN,
  requestOrigin: undefined,
  contentLength: "100",
  authorization: "Bearer good",
  ...over,
});

const newFakes = (
  init: { active?: boolean; memberError?: boolean; blocked?: string[] } = {},
) => {
  const counted: string[] = [];
  const logs: string[] = [];
  const deps = {
    verify: async (token: string) => (token === "good" ? PRINCIPAL : null),
    memberStatus: () =>
      init.memberError
        ? errAsync(newDatabaseError("select failed"))
        : okAsync({ active: init.active ?? true }),
    checkRateLimit: async (limit: { name: string }, subject?: string) => {
      counted.push(subject ? `${limit.name}:${subject}` : limit.name);
      return init.blocked?.includes(limit.name)
        ? { allowed: false as const, retryAfter: 42 }
        : { allowed: true as const };
    },
    log: {
      info: (m: string) => logs.push(`info ${m}`),
      error: (m: string) => logs.push(`error ${m}`),
    } as unknown as Logger,
  };
  return { deps, counted, logs };
};

describe("gateMcpRequest", () => {
  test("正しいトークンで, 退会しておらず, 上限内なら通す", async () => {
    const { deps, counted } = newFakes();
    expect(await gateMcpRequest(request(), deps)).toEqual({
      type: "Pass",
      principal: PRINCIPAL,
    });
    expect(counted).toEqual(["mcp:user:user1"]);
  });

  test("自分の Origin は通す", async () => {
    const { deps } = newFakes();
    const r = await gateMcpRequest(request({ requestOrigin: ORIGIN }), deps);
    expect(r.type).toBe("Pass");
  });

  test("別の Origin は 403", async () => {
    const { deps } = newFakes();
    const r = await gateMcpRequest(
      request({ requestOrigin: "https://evil.example" }),
      deps,
    );
    expect(r).toMatchObject({ type: "Reject", status: 403 });
  });

  test("大きすぎる本文は 413", async () => {
    const { deps } = newFakes();
    const r = await gateMcpRequest(
      request({ contentLength: String(65 * 1024) }),
      deps,
    );
    expect(r).toMatchObject({ type: "Reject", status: 413 });
  });

  test.each([
    ["トークンなし", undefined, false],
    ["正しくないトークン", "Bearer bad", true],
  ])(
    "%s は 401 で, 認可の流れへの案内を付け, 回数は数えない",
    async (_, authorization, invalid) => {
      const { deps, counted } = newFakes();
      const r = await gateMcpRequest(request({ authorization }), deps);
      expect(r).toMatchObject({ type: "Reject", status: 401 });
      const header =
        r.type === "Reject" ? (r.headers["WWW-Authenticate"] ?? "") : "";
      expect(header).toContain(
        `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
      );
      expect(header.includes('error="invalid_token"')).toBe(invalid);
      expect(counted).toEqual([]);
    },
  );

  test("退会したユーザーのトークンは 401", async () => {
    const { deps, counted } = newFakes({ active: false });
    const r = await gateMcpRequest(request(), deps);
    expect(r).toMatchObject({ type: "Reject", status: 401 });
    expect(counted).toEqual([]);
  });

  test("メンバーを確かめられなければ 500 で, 中身はログにだけ残す", async () => {
    const { deps, logs } = newFakes({ memberError: true });
    const r = await gateMcpRequest(request(), deps);
    expect(r).toMatchObject({ type: "Reject", status: 500 });
    expect(JSON.stringify(r)).not.toContain("select failed");
    expect(logs.some((l) => l.startsWith("error DatabaseError"))).toBeTrue();
  });

  test("1 人あたりの上限を超えたら 429", async () => {
    const { deps } = newFakes({ blocked: ["mcp:user"] });
    const r = await gateMcpRequest(request(), deps);
    expect(r).toMatchObject({
      type: "Reject",
      status: 429,
      headers: { "Retry-After": "42" },
    });
  });
});
