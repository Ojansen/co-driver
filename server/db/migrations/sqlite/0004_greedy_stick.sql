DROP INDEX `cars_ordinal_unique`;--> statement-breakpoint
ALTER TABLE `cars` ADD `gameId` text DEFAULT 'fh6' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `cars_game_ordinal_unq` ON `cars` (`gameId`,`ordinal`);--> statement-breakpoint
DROP INDEX `events_name_type_unq`;--> statement-breakpoint
ALTER TABLE `events` ADD `gameId` text DEFAULT 'fh6' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `events_game_name_type_unq` ON `events` (`gameId`,`name`,`type`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `gameId` text DEFAULT 'fh6' NOT NULL;