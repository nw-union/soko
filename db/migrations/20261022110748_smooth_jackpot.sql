-- void:allow-destructive
DROP INDEX `invites_email_pending_unique`;--> statement-breakpoint
ALTER TABLE `invites` ADD `inviter_user_id` text;--> statement-breakpoint
ALTER TABLE `invites` DROP COLUMN `name`;--> statement-breakpoint
ALTER TABLE `invites` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `invites` DROP COLUMN `color`;