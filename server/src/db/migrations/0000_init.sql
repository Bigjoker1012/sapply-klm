CREATE TABLE `batch` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`lot_no` text,
	`supplier_id` integer,
	`manufacture_date` text,
	`expiry_date` text,
	`initial_qty_kg` real NOT NULL,
	`current_qty_kg` real NOT NULL,
	`unit_price` real,
	`currency` text,
	`certificate_no` text,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`sku_id`) REFERENCES `sku`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouse`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "batch_qty_nonneg" CHECK("batch"."initial_qty_kg" >= 0 AND "batch"."current_qty_kg" >= 0),
	CONSTRAINT "batch_qty_le_initial" CHECK("batch"."current_qty_kg" <= "batch"."initial_qty_kg"),
	CONSTRAINT "batch_price_nonneg" CHECK("batch"."unit_price" IS NULL OR "batch"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batch_sku_lot_wh_unique` ON `batch` (`sku_id`,`lot_no`,`warehouse_id`) WHERE "batch"."lot_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `batch_expiry_idx` ON `batch` (`expiry_date`);--> statement-breakpoint
CREATE INDEX `batch_current_idx` ON `batch` (`sku_id`,`warehouse_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `batch_identity_unique` ON `batch` (`id`,`sku_id`,`warehouse_id`);--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`before_json` text,
	`after_json` text,
	`ip` text,
	`occurred_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_log_entity_idx` ON `event_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `event_log_actor_idx` ON `event_log` (`actor_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `in_transit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku_id` integer NOT NULL,
	`supplier_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`qty_kg` real NOT NULL,
	`unit_price` real,
	`currency` text,
	`eta_date` text,
	`transport` text,
	`status` text DEFAULT 'at_supplier' NOT NULL,
	`po_ref` text,
	`received_batch_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`sku_id`) REFERENCES `sku`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouse`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_batch_id`) REFERENCES `batch`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "in_transit_qty_pos" CHECK("in_transit"."qty_kg" > 0),
	CONSTRAINT "in_transit_price_nonneg" CHECK("in_transit"."unit_price" IS NULL OR "in_transit"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE INDEX `in_transit_eta_idx` ON `in_transit` (`eta_date`,`status`);--> statement-breakpoint
CREATE INDEX `in_transit_wh_status_eta_idx` ON `in_transit` (`warehouse_id`,`status`,`eta_date`);--> statement-breakpoint
CREATE INDEX `in_transit_sku_status_idx` ON `in_transit` (`sku_id`,`status`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`inn` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_code_unique` ON `organization` (`code`);--> statement-breakpoint
CREATE TABLE `production_plan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`qty_t` real NOT NULL,
	`planned_date` text NOT NULL,
	`warehouse_id` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`actual_qty_t` real,
	`done_at` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouse`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plan_qty_pos" CHECK("production_plan"."qty_t" > 0),
	CONSTRAINT "plan_actual_nonneg" CHECK("production_plan"."actual_qty_t" IS NULL OR "production_plan"."actual_qty_t" >= 0)
);
--> statement-breakpoint
CREATE INDEX `plan_date_idx` ON `production_plan` (`planned_date`,`status`);--> statement-breakpoint
CREATE INDEX `plan_wh_date_idx` ON `production_plan` (`warehouse_id`,`planned_date`,`status`);--> statement-breakpoint
CREATE TABLE `purchase_order` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku_id` integer NOT NULL,
	`supplier_id` integer NOT NULL,
	`qty_kg` real NOT NULL,
	`unit_price` real,
	`currency` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`expected_eta` text,
	`in_transit_id` integer,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`sku_id`) REFERENCES `sku`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`in_transit_id`) REFERENCES `in_transit`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "po_qty_pos" CHECK("purchase_order"."qty_kg" > 0),
	CONSTRAINT "po_price_nonneg" CHECK("purchase_order"."unit_price" IS NULL OR "purchase_order"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE INDEX `po_status_eta_idx` ON `purchase_order` (`status`,`expected_eta`);--> statement-breakpoint
CREATE INDEX `po_supplier_status_idx` ON `purchase_order` (`supplier_id`,`status`);--> statement-breakpoint
CREATE INDEX `po_sku_status_idx` ON `purchase_order` (`sku_id`,`status`);--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`target_animal` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`active_from` text,
	`active_to` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`source_pdf_id` integer,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`source_pdf_id`) REFERENCES `upload_job`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_code_version_unique` ON `recipe` (`code`,`version`);--> statement-breakpoint
CREATE INDEX `recipe_active_lookup_idx` ON `recipe` (`code`,`status`,`active_from`,`active_to`);--> statement-breakpoint
CREATE TABLE `recipe_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`sku_id` integer NOT NULL,
	`dose_kg_per_t` real NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`note` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sku_id`) REFERENCES `sku`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipe_item_dose_pos" CHECK("recipe_item"."dose_kg_per_t" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_item_recipe_sku_unique` ON `recipe_item` (`recipe_id`,`sku_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text NOT NULL,
	`ip` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_expiry_idx` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sku` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`unit` text DEFAULT 'кг' NOT NULL,
	`default_supplier_id` integer,
	`shelf_life_days` integer,
	`min_stock_kg` real,
	`reorder_point_kg` real,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`default_supplier_id`) REFERENCES `supplier`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sku_code_unique` ON `sku` (`code`);--> statement-breakpoint
CREATE TABLE `sku_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku_id` integer NOT NULL,
	`alias` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`sku_id`) REFERENCES `sku`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sku_alias_lower_unique` ON `sku_alias` (lower("alias"));--> statement-breakpoint
CREATE TABLE `stock_movement` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`kind` text NOT NULL,
	`qty_kg` real NOT NULL,
	`ref_type` text,
	`ref_id` integer,
	`occurred_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`actor_id` integer,
	`comment` text,
	FOREIGN KEY (`batch_id`) REFERENCES `batch`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "movement_qty_pos" CHECK("stock_movement"."qty_kg" > 0)
);
--> statement-breakpoint
CREATE INDEX `movement_batch_idx` ON `stock_movement` (`batch_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `movement_ref_idx` ON `stock_movement` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `stock_snapshot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`warehouse_id` integer NOT NULL,
	`snapshot_date` text NOT NULL,
	`source` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouse`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`country` text,
	`inn` text,
	`contact` text,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transfer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku_id` integer NOT NULL,
	`from_warehouse_id` integer NOT NULL,
	`to_warehouse_id` integer NOT NULL,
	`qty_kg` real NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`planned_date` text,
	`completed_at` text,
	`created_by` integer,
	`comment` text,
	FOREIGN KEY (`sku_id`) REFERENCES `sku`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouse`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouse`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfer_qty_pos" CHECK("transfer"."qty_kg" > 0),
	CONSTRAINT "transfer_from_ne_to" CHECK("transfer"."from_warehouse_id" <> "transfer"."to_warehouse_id")
);
--> statement-breakpoint
CREATE INDEX `transfer_from_status_idx` ON `transfer` (`from_warehouse_id`,`status`,`planned_date`);--> statement-breakpoint
CREATE INDEX `transfer_to_status_idx` ON `transfer` (`to_warehouse_id`,`status`,`planned_date`);--> statement-breakpoint
CREATE INDEX `transfer_sku_status_idx` ON `transfer` (`sku_id`,`status`);--> statement-breakpoint
CREATE TABLE `transfer_batch` (
	`transfer_id` integer NOT NULL,
	`batch_id` integer NOT NULL,
	`batch_sku_id` integer NOT NULL,
	`batch_warehouse_id` integer NOT NULL,
	`qty_kg` real NOT NULL,
	PRIMARY KEY(`transfer_id`, `batch_id`),
	FOREIGN KEY (`transfer_id`) REFERENCES `transfer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_sku_id`) REFERENCES `sku`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_warehouse_id`) REFERENCES `warehouse`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`,`batch_sku_id`,`batch_warehouse_id`) REFERENCES `batch`(`id`,`sku_id`,`warehouse_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfer_batch_qty_pos" CHECK("transfer_batch"."qty_kg" > 0)
);
--> statement-breakpoint
CREATE TABLE `upload_job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	`uploaded_by` integer,
	`uploaded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`status` text DEFAULT 'parsing' NOT NULL,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`rows_matched` integer DEFAULT 0 NOT NULL,
	`rows_unmatched` integer DEFAULT 0 NOT NULL,
	`applied_at` text,
	`error` text,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_job_hash_unique` ON `upload_job` (`file_hash`);--> statement-breakpoint
CREATE TABLE `upload_row` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`upload_job_id` integer NOT NULL,
	`row_index` integer NOT NULL,
	`sheet_name` text,
	`raw_payload` text NOT NULL,
	`matched_sku_id` integer,
	`confidence` real,
	`action` text DEFAULT 'manual_review' NOT NULL,
	`reviewed_by` integer,
	`reviewed_at` text,
	`review_note` text,
	FOREIGN KEY (`upload_job_id`) REFERENCES `upload_job`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_sku_id`) REFERENCES `sku`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `upload_row_job_idx` ON `upload_row` (`upload_job_id`,`action`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`login` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`organization_id` integer,
	`active` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_login_unique` ON `user` (`login`);--> statement-breakpoint
CREATE TABLE `warehouse` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_main` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouse_code_unique` ON `warehouse` (`code`);