import { sql } from 'drizzle-orm'
import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const eventType = ['rally', 'race', 'street_race', 'cross_country', 'drag', 'freeroam'] as const
export type EventType = typeof eventType[number]

export const events = sqliteTable('events', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  type: text({ enum: eventType }).notNull(),
  createdAt: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
}, t => [
  uniqueIndex('events_name_type_unq').on(t.name, t.type)
])

export const cars = sqliteTable('cars', {
  id: integer().primaryKey({ autoIncrement: true }),
  ordinal: integer().notNull().unique(),
  class: integer().notNull(),
  displayName: text()
})

export const sessions = sqliteTable('sessions', {
  id: integer().primaryKey({ autoIncrement: true }),
  eventId: integer().notNull().references(() => events.id),
  carId: integer().notNull().references(() => cars.id),
  tuneLabel: text(),
  piAtStart: integer().notNull(),
  startedAt: integer({ mode: 'timestamp' }).notNull(),
  endedAt: integer({ mode: 'timestamp' })
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
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Lap = typeof laps.$inferSelect
export type NewLap = typeof laps.$inferInsert
