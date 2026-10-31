// 新着動画のプッシュ通知（サーバー用）。動画を同期する cron（crons/sync-*.ts）の最後に呼ぶ。
import { db, inArray, sql } from "void/db";
import { env } from "void/env";
import { pushSubscriptions } from "@schema";
import { sendPush, type VapidKeys } from "./web-push";

// 投稿からこれより古い動画は、新しく取り込んでも通知しない。
// プレイリストを追加したときなどに、昔の動画の通知がまとめて届かないように
const RECENT_DAYS = 3;

// VAPID の鍵。どれかが未設定なら null（通知の機能を使わない）
export const vapidKeys = (): VapidKeys | null =>
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      }
    : null;

// sw.js の push イベントが受け取る中身
export type PushPayload = {
  title: string;
  body: string;
  // 通知を押したときに開く URL（/?v=<YouTube の動画 ID> でその動画を再生する）
  url: string;
};

type NewVideo = {
  youtube_id: string;
  title: string;
  published_at: string | null;
};

// まだ通知していない動画を通知済みにして、そのうち最近のものを全購読者に 1 通で知らせる。
// 通知済みにする UPDATE は 1 文なので、2 つの cron が同時に動いても、同じ動画を 2 回通知しない
export const notifyNewVideos = async () => {
  const claimed = await db.all<NewVideo>(sql`
    UPDATE videos SET notified_at = datetime('now')
    WHERE notified_at IS NULL
    RETURNING youtube_id, title, published_at`);
  const since = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const recent = claimed
    .filter((v) => v.published_at && Date.parse(v.published_at) >= since)
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  if (recent.length === 0) return;

  const vapid = vapidKeys();
  if (!vapid) {
    console.warn(
      `push: VAPID の鍵が未設定のため、新着動画 ${recent.length} 本の通知をスキップします`,
    );
    return;
  }

  // プッシュの本文は 4KB まで。暗号化の分を見込んで、本文は短く切る
  const body = recent.map((v) => v.title).join(" / ");
  const payload: PushPayload = {
    title: recent.length === 1 ? "新着動画" : `新着動画が ${recent.length} 本`,
    body: body.length > 200 ? `${body.slice(0, 199)}…` : body,
    // 押すと、いちばん新しい動画を再生する
    url: `/?v=${recent[0].youtube_id}`,
  };

  const subs = await db.select().from(pushSubscriptions);
  const results = await Promise.allSettled(
    subs.map((sub) => sendPush(sub, payload, vapid)),
  );

  // 404 / 410 は、端末が購読をやめた（アプリを消したなど）。もう送れないので消す
  const gone: number[] = [];
  let sent = 0;
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.warn(`push: 送信に失敗しました: ${result.reason}`);
    } else if (result.value.ok) {
      sent++;
    } else if (result.value.status === 404 || result.value.status === 410) {
      gone.push(subs[i].id);
    } else {
      console.warn(`push: 送信に失敗しました: ${result.value.status}`);
    }
  });
  if (gone.length > 0)
    await db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, gone));
  console.log(
    `push: 新着動画 ${recent.length} 本を ${sent} / ${subs.length} 件に通知しました（無効な購読 ${gone.length} 件を削除）`,
  );
};
