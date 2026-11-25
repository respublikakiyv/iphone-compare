CREATE TABLE `account_links` (
	`web_id` text PRIMARY KEY NOT NULL,
	`telegram_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_links_telegram_id_unique` ON `account_links` (`telegram_id`);--> statement-breakpoint
CREATE TABLE `cloud_refresh` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`lease` integer DEFAULT 0 NOT NULL,
	`token` text DEFAULT '' NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `link_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`telegram_id` text NOT NULL,
	`expires` integer NOT NULL
);
