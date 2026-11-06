-- void:allow-destructive
-- 「destructive」になるのは末尾の UPDATE だけ（追加したばかりの notified_at を埋めるだけで、既存のデータは消えない）
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
ALTER TABLE `videos` ADD `notified_at` text;--> statement-breakpoint
-- 既存の動画は通知済みにする（通知を有効にした直後に、全部の動画の通知が飛ばないように）
UPDATE `videos` SET `notified_at` = datetime('now');