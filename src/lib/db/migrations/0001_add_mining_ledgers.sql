CREATE TABLE `mined_companies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`domain` text NOT NULL,
	`name` text,
	`people_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` text DEFAULT (datetime('now')),
	`last_mined_at` text
);
--> statement-breakpoint
CREATE TABLE `mined_people` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`rr_id` integer,
	`linkedin_url` text,
	`email` text,
	`company_domain` text,
	`name` text,
	`title` text,
	`company` text,
	`location` text,
	`phone` text,
	`status` text DEFAULT 'seen' NOT NULL,
	`source` text,
	`query_hash` text,
	`first_seen_at` text DEFAULT (datetime('now')),
	`enriched_at` text,
	`delivered_at` text
);
--> statement-breakpoint
CREATE TABLE `search_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`query_hash` text NOT NULL,
	`query_json` text,
	`label` text,
	`next_start` integer DEFAULT 1 NOT NULL,
	`last_run_at` text,
	`last_yield` integer DEFAULT 0,
	`low_yield_streak` integer DEFAULT 0 NOT NULL,
	`total_matches` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
