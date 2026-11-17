import { stepAsync } from "@nw-union/nw-utils/lib/rslt";
import { sql } from "void/db";
import type { ProfileRepositoryPort } from "../../domain/Member/port.ts";
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
});
