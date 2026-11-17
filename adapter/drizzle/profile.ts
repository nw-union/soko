import { stepAsync } from "@nw-union/nw-utils/lib/rslt";
import { sql } from "void/db";
import type { ProfileRepositoryPort } from "../../domain/Member/profile/port.ts";
import { type Database, query } from "./util.ts";

export const newProfileRepository = (db: Database): ProfileRepositoryPort => ({
  countPasskeys: (user) =>
    stepAsync(
      query("countPasskeys", () =>
        db.all<{ count: number }>(
          sql`SELECT COUNT(*) AS count FROM passkey WHERE userId = ${user}`,
        ),
      ),
      (rows) => rows[0]?.count ?? 0,
    ),

  readImage: (user) =>
    stepAsync(
      query("readImage", () =>
        db.all<{ image: string | null }>(
          sql`SELECT image FROM user WHERE id = ${user}`,
        ),
      ),
      (rows) => rows[0]?.image ?? null,
    ),

  // user テーブルは better-auth の管理で, updatedAt はミリ秒の整数
  updateImage: (user, image, now) =>
    stepAsync(
      query("updateImage", () =>
        db.run(
          sql`UPDATE user SET image = ${image}, updatedAt = ${now.getTime()} WHERE id = ${user}`,
        ),
      ),
      () => undefined,
    ),

  deleteUserData: (user) =>
    // 1 文ずつ消す（drizzle の batch は db.run(sql) を受け付けない）。途中で失敗しても、次の退会処理や手作業で消し直せる
    query("deleteUserData", async () => {
      // 使用済みの招待の記録は残す
      await db.run(
        sql`DELETE FROM invites WHERE inviter_user_id = ${user} AND used_at IS NULL`,
      );
      await db.run(sql`DELETE FROM push_subscriptions WHERE user_id = ${user}`);
      await db.run(sql`DELETE FROM video_watches WHERE user_id = ${user}`);
    }),
});
