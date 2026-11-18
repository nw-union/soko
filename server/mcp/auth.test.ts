import { beforeAll, describe, expect, test } from "bun:test";
import {
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type KeyObject,
  SignJWT,
} from "jose";
import { newAccessTokenVerifier, parseBearer } from "./auth.ts";

const ORIGIN = "https://soko.example";
const NOW = Math.floor(Date.now() / 1000);

let privateKey: CryptoKey | KeyObject;
let otherKey: CryptoKey | KeyObject;
let jwks: JSONWebKeySet;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("EdDSA")).privateKey;
  jwks = {
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "EdDSA" }],
  };
});

const sign = (
  claims: Record<string, unknown> = {},
  opts: {
    key?: CryptoKey | KeyObject;
    typ?: string;
    exp?: number;
    iss?: string;
    aud?: string;
  } = {},
) =>
  new SignJWT({
    sub: "user1",
    azp: "client1",
    scope: "videos:read watches:write offline_access openid",
    joined_at: "2026-01-01T00:00:00.000Z",
    ...claims,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ: opts.typ ?? "at+jwt" })
    .setIssuer(opts.iss ?? `${ORIGIN}/api/auth`)
    .setAudience(opts.aud ?? `${ORIGIN}/api/mcp`)
    .setIssuedAt(NOW)
    .setExpirationTime(opts.exp ?? NOW + 3600)
    .sign(opts.key ?? privateKey);

const verify = (token: string) =>
  newAccessTokenVerifier(ORIGIN, async () => jwks)(token);

describe("parseBearer", () => {
  test.each([
    ["Bearer abc.def-ghi_", "abc.def-ghi_"],
    ["bearer abc", "abc"],
    [null, null],
    ["", null],
    ["Basic abc", null],
    ["Bearer", null],
    ["Bearer a b", null],
  ])("%p → %p", (header, expected) => {
    expect(parseBearer(header)).toBe(expected);
  });
});

describe("newAccessTokenVerifier", () => {
  test("正しいトークンなら, ユーザー・クライアント・MCP のスコープを返す", async () => {
    expect(await verify(await sign())).toEqual({
      userId: "user1",
      joinedAt: "2026-01-01T00:00:00.000Z",
      clientId: "client1",
      // offline_access・openid は MCP のスコープではないので落とす
      scopes: ["videos:read", "watches:write"],
    });
  });

  test("スコープがなければ空", async () => {
    const actual = await verify(await sign({ scope: undefined }));
    expect(actual?.scopes).toEqual([]);
  });

  test.each([
    ["別の鍵の署名", () => sign({}, { key: otherKey })],
    ["期限切れ", () => sign({}, { exp: NOW - 10 })],
    ["typ が at+jwt でない（ID トークンなど）", () => sign({}, { typ: "JWT" })],
    ["宛先が別のリソース", () => sign({}, { aud: `${ORIGIN}/api/other` })],
    [
      "宛先が別のホスト",
      () => sign({}, { aud: "https://evil.example/api/mcp" }),
    ],
    ["発行者が別", () => sign({}, { iss: "https://evil.example/api/auth" })],
    ["joined_at がない", () => sign({ joined_at: undefined })],
    ["クライアントがない", () => sign({ azp: undefined })],
  ])("拒否する: %s", async (_, make) => {
    expect(await verify(await make())).toBeNull();
  });

  test("JWT でない文字列は拒否する", async () => {
    expect(await verify("not-a-jwt")).toBeNull();
  });
});
