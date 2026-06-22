CREATE TABLE `seen_urls` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`url_hash` text NOT NULL,
	`url` text,
	`source_label` text,
	`first_seen_at` text DEFAULT (datetime('now')),
	`last_seen_at` text DEFAULT (datetime('now')),
	`times_seen` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_watermarks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`source_key` text NOT NULL,
	`label` text,
	`last_published_date` text,
	`last_run_at` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
ALTER TABLE `mined_people` ADD `identity_key` text;