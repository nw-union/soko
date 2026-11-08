import { sql } from "void/db";
import type { InviteRepositoryPort } from "../../domain/Member/invite/port.ts";
import { type Database, query, toSqliteDatetime } from "./util.ts";

type InviteRow = {
  id: number;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by_name: string | null;
};

// 数える招待 (発行上限に数えるもの): 使用済みか, まだ使えるもの. 期限切れで未使用の招待は数えない
const counted = (now: string) =>
  sql`NOT (used_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ${now})`;

// 使える招待: 未使用で, 期限がないか今より後
const usable = (now: string) =>
  sql`used_at IS NULL AND (expires_at IS NULL OR expires_at > ${now})`;

export const newInviteRepository = (db: Database): InviteRepositoryPort => ({
  listInvites: (inviter) =>
    query("listInvites", () =>
      db.all<InviteRow>(sql`
        SELECT i.id, i.created_at, i.expires_at, i.used_at, u.name AS used_by_name
        FROM invites i LEFT JOIN user u ON u.id = i.used_by_user_id
        WHERE i.inviter_user_id = ${inviter}
        ORDER BY i.id DESC`),
    ).map((rows) =>
      rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        usedAt: row.used_at,
        usedByName: row.used_by_name,
      })),
    ),

  readUsage: (inviter, now) =>
    query("readUsage", () =>
      db.all<{ used: number; limit: number | null }>(sql`
        SELECT
          (SELECT COUNT(*) FROM invites
            WHERE inviter_user_id = ${inviter} AND ${counted(toSqliteDatetime(now))}) AS used,
          (SELECT inviteLimit FROM user WHERE id = ${inviter}) AS "limit"`),
    ).map(([row]) => ({
      type: "InviteUsage" as const,
      limit: row?.limit ?? null,
      used: row?.used ?? 0,
    })),

  // 件数の確認と追加を 1 文で行う. 同時に押されても上限を超えない
  insertInviteIfUnderLimit: (invite, defaultLimit, now) =>
    query("insertInviteIfUnderLimit", () =>
      db.run(sql`
        INSERT INTO invites (token_hash, inviter_user_id, expires_at)
        SELECT ${invite.tokenHash}, ${invite.inviterUserId}, ${toSqliteDatetime(invite.expiresAt)}
        WHERE (SELECT COUNT(*) FROM invites
            WHERE inviter_user_id = ${invite.inviterUserId} AND ${counted(toSqliteDatetime(now))})
          < COALESCE((SELECT inviteLimit FROM user WHERE id = ${invite.inviterUserId}), ${defaultLimit})`),
    ).map((result) => Boolean(result.meta?.changes)),

  deleteUnusedInvite: (id, inviter) =>
    query("deleteUnusedInvite", () =>
      db.run(sql`
        DELETE FROM invites
        WHERE id = ${id} AND inviter_user_id = ${inviter} AND used_at IS NULL`),
    ).map(() => undefined),

  isUsableInvite: (hash, now) =>
    query("isUsableInvite", () =>
      db.all<{ id: number }>(sql`
        SELECT id FROM invites
        WHERE token_hash = ${hash} AND ${usable(toSqliteDatetime(now))}
        LIMIT 1`),
    ).map((rows) => rows.length > 0),

  // 確認と更新を 1 文で行う. 同じトークンで同時に登録されても, 成功するのは 1 回だけ
  claimInvite: (hash, now) =>
    query("claimInvite", () =>
      db.run(sql`
        UPDATE invites SET used_at = ${toSqliteDatetime(now)}
        WHERE token_hash = ${hash} AND ${usable(toSqliteDatetime(now))}`),
    ).map((result) => Boolean(result.meta?.changes)),

  setInvitedUser: (hash, user) =>
    query("setInvitedUser", () =>
      db.run(
        sql`UPDATE invites SET used_by_user_id = ${user} WHERE token_hash = ${hash}`,
      ),
    ).map(() => undefined),
});
