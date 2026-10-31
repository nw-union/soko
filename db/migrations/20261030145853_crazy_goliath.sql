CREATE TABLE `video_watches` (
	`user_id` text NOT NULL,
	`youtube_id` text NOT NULL,
	`watched_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `youtube_id`)
);
