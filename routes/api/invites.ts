import { defineHandler } from "void";
import { requireAuth } from "void/auth";
import { db, sql } from "void/db";
import {
  formatToken,
  generateToken,
  hashToken,
  DEFAULT_INVITE_LIMIT,
  INVITE_DAYS,
} from "../../src/lib/invite";

// 数えるのは「使用済み」か「まだ使える」もの。期限切れで未使用の招待は枠が戻る
const COUNTED = sql`NOT (used_at IS NULL AND expires_at IS NOT NULL AND expires_at <= datetime('now'))`;

type Row = {
  id: number;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by_name: string | null;
};

// そのユーザーの招待の上限（user.inviteLimit）。値がなければ初期値
const limitOf = (userId: string) =>
  sql`COALESCE((SELECT inviteLimit FROM user WHERE id = ${userId}), ${DEFAULT_INVITE_LIMIT})`;

// 自分が発行した招待の一覧と、あと何回発行できるか
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c);
  const rows = await db.all<Row>(sql`
    SELECT i.id, i.created_at, i.expires_at, i.used_at, u.name AS used_by_name
    FROM invites i LEFT JOIN user u ON u.id = i.used_by_user_id
    WHERE i.inviter_user_id = ${user.id}
    ORDER BY i.id DESC`);
  const [count] = await db.all<{ used: number; limit: number }>(sql`
    SELECT (SELECT COUNT(*) FROM invites WHERE inviter_user_id = ${user.id} AND ${COUNTED}) AS used,
      ${limitOf(user.id)} AS "limit"`);
  const limit = count?.limit ?? DEFAULT_INVITE_LIMIT;
  return {
    limit,
    remaining: Math.max(0, limit - (count?.used ?? 0)),
    invites: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      usedByName: row.used_by_name,
    })),
  };
});

// 招待を発行する。トークンはこのレスポンスで 1 回だけ返す（DB にはハッシュしか残らない）
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c);
  const token = generateToken();
  // 件数の確認と追加を 1 文で行う。同時に押されても上限を超えない
  const result = await db.run(sql`
    INSERT INTO invites (token_hash, inviter_user_id, expires_at)
    SELECT ${await hashToken(token)}, ${user.id}, datetime('now', ${`+${INVITE_DAYS} days`})
    WHERE (SELECT COUNT(*) FROM invites WHERE inviter_user_id = ${user.id} AND ${COUNTED}) < ${limitOf(user.id)}`);
  if (!result.meta?.changes) {
    return c.json({ message: `招待の発行上限に達しています` }, 409);
  }
  return { token: formatToken(token), days: INVITE_DAYS };
});

// 未使用の招待を取り消す（枠が戻る）
export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c);
  const id = Number(c.req.query("id"));
  if (!Number.isInteger(id))
    return c.json({ message: "id が正しくありません" }, 400);
  await db.run(
    sql`DELETE FROM invites WHERE id = ${id} AND inviter_user_id = ${user.id} AND used_at IS NULL`,
  );
  return null;
});
