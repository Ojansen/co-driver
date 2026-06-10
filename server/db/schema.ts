import { sql } from 'drizzle-orm'
import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
// Relative (not the `#shared` alias) so drizzle-kit's migration generator can
// resolve it outside the Nuxt/Nitro runtime. games.ts is pure TS, no Nuxt deps.
import { GAME_IDS } from '../../shared/games'

export const eventType = ['rally', 'race', 'street_race', 'touge', 'cross_country', 'drag', 'custom', 'freeroam'] as const
export type EventType = typeof eventType[number]

export const events = sqliteTable('events', {
  id: integer().primaryKey({ autoIncrement: true }),
  // The game this event belongs to. Existing rows backfill to 'fh6' (all data
  // pre-multi-game was Forza Horizon).
  gameId: text({ enum: GAME_IDS }).notNull().default('fh6'),
  name: text().notNull(),
  // An event is {game, name} — a track/race. `type` is an OPTIONAL discipline
  // tag (the Forza-Horizon taxonomy: rally/touge/cross_country/…); it doesn't
  // generalise to other sims, so it's nullable and only Horizon tends to set it.
  type: text({ enum: eventType }),
  createdAt: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
}, t => [
  // One event per (game, name): the track/race is the identity. Discipline is
  // metadata, not part of the key.
  uniqueIndex('events_game_name_unq').on(t.gameId, t.name)
])

export const cars = sqliteTable('cars', {
  id: integer().primaryKey({ autoIncrement: true }),
  // Car catalogs are per-game: an ordinal is only unique within a game (an F1
  // car id can collide with a Forza ordinal). Existing rows backfill to 'fh6'.
  gameId: text({ enum: GAME_IDS }).notNull().default('fh6'),
  ordinal: integer().notNull(),
  class: integer().notNull(),
  displayName: text()
}, t => [
  uniqueIndex('cars_game_ordinal_unq').on(t.gameId, t.ordinal)
])

/**
 * builds = the upgrade-side configuration of a car (post-homologation specs).
 * A car can have many named builds (e.g. "S2 race trim," "X-class monster").
 * Each build can host many tunes (slider iterations).
 *
 * Settings shape: see app/utils/build-fields.ts BUILD_FIELDS.
 */
export const builds = sqliteTable('builds', {
  id: integer().primaryKey({ autoIncrement: true }),
  carId: integer().notNull().references(() => cars.id),
  name: text().notNull(),
  settings: text({ mode: 'json' }).notNull().default(sql`('{}')`),
  createdAt: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
}, t => [
  uniqueIndex('builds_car_name_unq').on(t.carId, t.name)
])

/**
 * tunes = the slider-side configuration that lives on top of a specific build.
 * Phase 1b populates this with form/display UI; the table is created now so
 * sessions can reference (build, tune) pairs from day one.
 */
export const tunes = sqliteTable('tunes', {
  id: integer().primaryKey({ autoIncrement: true }),
  buildId: integer().notNull().references(() => builds.id),
  name: text().notNull(),
  settings: text({ mode: 'json' }).notNull().default(sql`('{}')`),
  createdAt: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
}, t => [
  uniqueIndex('tunes_build_name_unq').on(t.buildId, t.name)
])

export const sessions = sqliteTable('sessions', {
  id: integer().primaryKey({ autoIncrement: true }),
  // Which game produced this recording. Mirrors the event/car gameId (a session
  // can only reference an event + car of its own game). Existing rows → 'fh6'.
  gameId: text({ enum: GAME_IDS }).notNull().default('fh6'),
  eventId: integer().notNull().references(() => events.id),
  carId: integer().notNull().references(() => cars.id),
  tuneLabel: text(),
  piAtStart: integer().notNull(),
  startedAt: integer({ mode: 'timestamp' }).notNull(),
  endedAt: integer({ mode: 'timestamp' }),
  buildId: integer().references(() => builds.id),
  buildSnapshot: text({ mode: 'json' }),
  tuneId: integer().references(() => tunes.id),
  tuneSnapshot: text({ mode: 'json' })
})

export const laps = sqliteTable('laps', {
  id: integer().primaryKey({ autoIncrement: true }),
  sessionId: integer().notNull().references(() => sessions.id),
  lapNumber: integer().notNull(),
  timeMs: integer().notNull(),
  framesBlob: blob({ mode: 'buffer' }).notNull()
})

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type Car = typeof cars.$inferSelect
export type NewCar = typeof cars.$inferInsert
export type Build = typeof builds.$inferSelect
export type NewBuild = typeof builds.$inferInsert
export type Tune = typeof tunes.$inferSelect
export type NewTune = typeof tunes.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Lap = typeof laps.$inferSelect
export type NewLap = typeof laps.$inferInsert
