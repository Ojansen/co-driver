import { desc, eq, sql } from 'drizzle-orm'
import { db, schema } from 'hub:db'

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const buildId = Number(idParam)
  if (!Number.isInteger(buildId) || buildId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid build id' })
  }

  const build = (await db
    .select({ id: schema.builds.id })
    .from(schema.builds)
    .where(eq(schema.builds.id, buildId))
    .limit(1))[0]

  if (!build) {
    throw createError({ statusCode: 404, statusMessage: 'build not found' })
  }

  return await db
    .select({
      sessionId: schema.sessions.id,
      eventId: schema.sessions.eventId,
      eventType: schema.events.type,
      eventName: schema.events.name,
      startedAt: schema.sessions.startedAt,
      endedAt: schema.sessions.endedAt,
      piAtStart: schema.sessions.piAtStart,
      tuneLabel: schema.sessions.tuneLabel,
      lapCount: sql<number>`COUNT(${schema.laps.id})`.as('lapCount'),
      bestLapMs: sql<number | null>`MIN(${schema.laps.timeMs})`.as('bestLapMs'),
      bestLapId: sql<number | null>`(
        SELECT ${schema.laps.id}
        FROM ${schema.laps}
        WHERE ${schema.laps.sessionId} = ${schema.sessions.id}
        ORDER BY ${schema.laps.timeMs} ASC, ${schema.laps.id} ASC
        LIMIT 1
      )`.as('bestLapId')
    })
    .from(schema.sessions)
    .innerJoin(schema.events, eq(schema.events.id, schema.sessions.eventId))
    .leftJoin(schema.laps, eq(schema.laps.sessionId, schema.sessions.id))
    .where(eq(schema.sessions.buildId, buildId))
    .groupBy(schema.sessions.id)
    .orderBy(desc(schema.sessions.startedAt))
})
