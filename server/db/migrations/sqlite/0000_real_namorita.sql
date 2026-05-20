CREATE TABLE `cars` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordinal` integer NOT NULL,
	`class` integer NOT NULL,
	`displayName` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cars_ordinal_unique` ON `cars` (`ordinal`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_name_type_unq` ON `events` (`name`,`type`);--> statement-breakpoint
CREATE TABLE `laps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sessionId` integer NOT NULL,
	`lapNumber` integer NOT NULL,
	`timeMs` integer NOT NULL,
	`framesBlob` blob NOT NULL,
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`eventId` integer NOT NULL,
	`carId` integer NOT NULL,
	`tuneLabel` text,
	`piAtStart` integer NOT NULL,
	`startedAt` integer NOT NULL,
	`endedAt` integer,
	FOREIGN KEY (`eventId`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`carId`) REFERENCES `cars`(`id`) ON UPDATE no action ON DELETE no action
);
