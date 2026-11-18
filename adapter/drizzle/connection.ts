import { stepAsync } from "@nw-union/nw-utils/lib/rslt";
import { sql } from "void/db";
import type { ConnectionRepositoryPort } from "../../domain/Member/port.ts";
import type { ConnectedApp } from "../../domain/Member/type.ts";
import { newOAuthClientId } from "../../domain/Member/vo.ts";
import { mustVo } from "../../domain/shared/vo.ts";
import { type Database, query } from "./util.ts";

// oauthConsent・oauthRefreshToken・oauthAccessToken・oauthClient は better-auth の oauth-provider が管理している。
// 日時はミリ秒の整数、スコープの配列は JSON の文字列で入っている

type Row = {
  clientId: string;
  name: string | null;
  uri: string | null;
  scopes: string | null;
  updatedAt: number;
  lastUsedAt: number | null;
};

/**
 * better-auth の string[] の列. D1 では JSON の文字列を, さらに JSON の文字列にした形で入っている
 * (例: "\"[\\\"videos:read\\\"]\""). 何重でも解き, JSON でなければ空白区切りとして読む
 */
export const parseScopes = (raw: string | null): string[] => {
  let v: unknown = raw;
  for (let i = 0; i < 3 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      break;
    }
  }
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string");
  return typeof v === "string" ? v.split(" ").filter((s) => s !== "") : [];
};

const toConnectedApp = (r: Row): ConnectedApp => ({
  type: "ConnectedApp",
  clientId: mustVo(newOAuthClientId(r.clientId)),
  name: r.name,
  uri: r.uri,
  scopes: parseScopes(r.scopes),
  consentedAt: new Date(r.updatedAt),
  lastUsedAt: r.lastUsedAt === null ? null : new Date(r.lastUsedAt),
});

export const newConnectionRepository = (
  db: Database,
): ConnectionRepositoryPort => ({
  listConnectedApps: (user) =>
    stepAsync(
      query("listConnectedApps", () =>
        db.all<Row>(
          sql`SELECT c.clientId AS clientId, cl.name AS name, cl.uri AS uri, c.scopes AS scopes, c.updatedAt AS updatedAt,
                (SELECT MAX(r.createdAt) FROM oauthRefreshToken r WHERE r.userId = c.userId AND r.clientId = c.clientId) AS lastUsedAt
              FROM oauthConsent c
              LEFT JOIN oauthClient cl ON cl.clientId = c.clientId
              WHERE c.userId = ${user}
              ORDER BY c.updatedAt DESC`,
        ),
      ),
      (rows) => rows.map(toConnectedApp),
    ),

  deleteGrant: (user, client) =>
    // 1 文ずつ消す（drizzle の batch は db.run(sql) を受け付けない）。
    // 先にトークンを消す（途中で失敗しても、同意だけが残り、トークンは使えなくなっている側に倒れる）
    query("deleteGrant", async () => {
      await db.run(
        sql`DELETE FROM oauthAccessToken WHERE userId = ${user} AND clientId = ${client}`,
      );
      await db.run(
        sql`DELETE FROM oauthRefreshToken WHERE userId = ${user} AND clientId = ${client}`,
      );
      await db.run(
        sql`DELETE FROM oauthConsent WHERE userId = ${user} AND clientId = ${client}`,
      );
    }),
});
