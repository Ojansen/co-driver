import { asc, eq, sql } from 'drizzle-orm'
import { db, schema } from 'hub:db'

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid event id' })
  }

  const eventRow = (await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .limit(1))[0]

  if (!eventRow) {
    throw createError({ statusCode: 404, statusMessage: 'event not found' })
  }

  // Leaderboard: each session with its best lap + lap count + car details.
  // Sessions without any laps still appear, sorted last.
  const sessions = await db
    .select({
      sessionId: schema.sessions.id,
      carId: schema.sessions.carId,
      carOrdinal: schema.cars.ordinal,
      carClass: schema.cars.class,
      carDisplayName: schema.cars.displayName,
      tuneLabel: schema.sessions.tuneLabel,
      piAtStart: schema.sessions.piAtStart,
      startedAt: schema.sessions.startedAt,
      endedAt: schema.sessions.endedAt,
      bestLapMs: sql<number | null>`MIN(${schema.laps.timeMs})`.as('bestLapMs'),
      lapCount: sql<number>`COUNT(${schema.laps.id})`.as('lapCount')
    })
    .from(schema.sessions)
    .innerJoin(schema.cars, eq(schema.cars.id, schema.sessions.carId))
    .leftJoin(schema.laps, eq(schema.laps.sessionId, schema.sessions.id))
    .where(eq(schema.sessions.eventId, id))
    .groupBy(schema.sessions.id)
    .orderBy(
      sql`CASE WHEN MIN(${schema.laps.timeMs}) IS NULL THEN 1 ELSE 0 END`,
      asc(sql`MIN(${schema.laps.timeMs})`)
    )

  return { event: eventRow, sessions }
})
