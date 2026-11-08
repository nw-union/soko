import { inArray, sql } from "void/db";
// auth.ts から読み込まれるので、Vite のエイリアス（@schema）ではなく相対パスで読む
import { pushSubscriptions } from "../../db/schema.ts";
import type { PushRepositoryPort } from "../../domain/Notification/port.ts";
import { type Database, query, toSqliteDatetime } from "./util.ts";

export const newPushRepository = (db: Database): PushRepositoryPort => ({
  upsertSubscription: (sub) =>
    query("upsertSubscription", () =>
      db.run(sql`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
        VALUES (${sub.userId}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth})
        ON CONFLICT (endpoint) DO UPDATE SET
          user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`),
    ).map(() => undefined),

  trimSubscriptions: (user, keep) =>
    query("trimSubscriptions", () =>
      db.run(sql`
        DELETE FROM push_subscriptions
        WHERE user_id = ${user} AND id NOT IN (
          SELECT id FROM push_subscriptions WHERE user_id = ${user}
          ORDER BY id DESC LIMIT ${keep})`),
    ).map(() => undefined),

  deleteSubscription: (user, endpoint) =>
    query("deleteSubscription", () =>
      db.run(
        sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${user}`,
      ),
    ).map(() => undefined),

  listSubscriptions: () =>
    query("listSubscriptions", () => db.select().from(pushSubscriptions)),

  deleteSubscriptions: (ids) =>
    query("deleteSubscriptions", () =>
      db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, ids)),
    ).map(() => undefined),

  // 通知済みにする UPDATE は 1 文なので, 2 つの cron が同時に動いても, 同じ動画を 2 回通知しない
  claimUnnotifiedVideos: (now) =>
    query("claimUnnotifiedVideos", () =>
      db.all<{
        youtube_id: string;
        title: string;
        published_at: string | null;
      }>(
        sql`
          UPDATE videos SET notified_at = ${toSqliteDatetime(now)}
          WHERE notified_at IS NULL
          RETURNING youtube_id, title, published_at`,
      ),
    ).map((rows) =>
      rows.map((row) => ({
        youtubeId: row.youtube_id,
        title: row.title,
        publishedAt: row.published_at,
      })),
    ),
});
