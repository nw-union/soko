import { describe, expect, it } from "bun:test";
import { unwrap } from "../../lib/rslt-test.ts";
import {
  convToConnectedAppDto,
  convToInviteDto,
  formatToken,
  resolveColor,
  resolveImage,
} from "./converter.ts";
import type { ConnectedApp } from "./type.ts";
import { newOAuthClientId } from "./vo.ts";
import { mustVo } from "../shared/vo.ts";
import { newInviteToken } from "./vo.ts";

export const mustInviteToken = (s: string) => unwrap(newInviteToken(s));

const TOKEN = "ABCDEFGHJKMNPQRS";

const KEY = `${"ab".repeat(16)}.png`;

// ----------------------------------------------------------------------------
// Converter
// ----------------------------------------------------------------------------
describe("formatToken", () => {
  it("4 文字ごとにハイフンで区切る", () => {
    expect(formatToken(mustInviteToken(TOKEN))).toBe("ABCD-EFGH-JKMN-PQRS");
  });
});

describe("convToInviteDto", () => {
  it("画面に出す項目だけを返す", () => {
    expect(
      convToInviteDto({
        type: "IssuedInvite",
        id: 1,
        createdAt: "2026-10-30 00:00:00",
        expiresAt: null,
        usedAt: "2026-10-31 00:00:00",
        usedByName: "ゲスト",
      }),
    ).toEqual({
      id: 1,
      createdAt: "2026-10-30 00:00:00",
      expiresAt: null,
      usedAt: "2026-10-31 00:00:00",
      usedByName: "ゲスト",
    });
  });
});

describe("resolveColor", () => {
  it("イメージカラーがあれば, 小文字にして使う", () => {
    expect(resolveColor("#AbCdEf", "user1")).toBe("#abcdef");
  });

  it.each([
    // 以前の実装 (src/lib/color.ts) で計算した値. 色が変わらないことを確かめる
    ["user1", "#3cddb7"],
    ["Bt7WuvDhIbRUCskh2aBknArKsBqAssOy", "#dd8a3c"],
    ["", "#dd3c3c"],
  ])("未設定なら, ユーザー ID (%s) から決まる色にする", (id, color) => {
    expect(resolveColor(null, id)).toBe(color);
  });

  it("不正な値なら, ユーザー ID から決まる色にする", () => {
    expect(resolveColor("red", "user1")).toBe("#3cddb7");
  });
});

describe("resolveImage", () => {
  it.each([
    ["このアプリのアイコン", `/files/avatars/${KEY}`],
    ["https の URL", "https://example.com/a.png"],
  ])("%s は, そのまま使う", (_, image) => {
    expect(resolveImage(image)).toBe(image);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["このアプリの別のパス", "/api/avatar"],
    ["空", null],
  ])("%s は使わない", (_, image) => {
    expect(resolveImage(image)).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// convToConnectedAppDto
// ----------------------------------------------------------------------------
describe("convToConnectedAppDto", () => {
  const app = (uri: string | null): ConnectedApp => ({
    type: "ConnectedApp",
    clientId: mustVo(newOAuthClientId("client1")),
    name: "Claude",
    uri,
    scopes: ["videos:read"],
    consentedAt: new Date("2026-11-01T00:00:00Z"),
    lastUsedAt: new Date("2026-11-02T00:00:00Z"),
  });

  it("日時を ISO 8601 にする", () => {
    expect(convToConnectedAppDto(app("https://claude.ai"))).toEqual({
      clientId: "client1",
      name: "Claude",
      uri: "https://claude.ai",
      scopes: ["videos:read"],
      consentedAt: "2026-11-01T00:00:00.000Z",
      lastUsedAt: "2026-11-02T00:00:00.000Z",
    });
  });

  it.each([["javascript:alert(1)"], ["not a url"]])(
    "http(s) でない URL は落とす (%p)",
    (uri) => {
      expect(convToConnectedAppDto(app(uri)).uri).toBeNull();
    },
  );
});
