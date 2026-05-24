import { gunzipSync } from 'node:zlib'
import { and, asc, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'

/**
 * Best lap (lowest timeMs) for a car. Optional `eventId` query param scopes
 * to a specific event — the hotlap PB fallback uses car + event together to
 * pick the right benchmark.
 *
 * Returns `null` when the car is unknown or has no completed laps under the
 * given filter. That's a normal "no PB yet" state, not an error.
 */
export default defineEventHandler(async (event) => {
  const ordinalParam = getRouterParam(event, 'ordinal')
  const ordinal = Number(ordinalParam)
  if (!Number.isInteger(ordinal) || ordinal <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid car ordinal' })
  }

  const query = getQuery(event)
  let eventIdFilter: number | null = null
  if (query.eventId !== undefined) {
    const parsed = Number(query.eventId)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'invalid event id' })
    }
    eventIdFilter = parsed
  }

  const car = (await db.select().from(schema.cars).where(eq(schema.cars.ordinal, ordinal)).limit(1))[0]
  if (!car) return null

  const whereClause = eventIdFilter !== null
    ? and(eq(schema.sessions.carId, car.id), eq(schema.sessions.eventId, eventIdFilter))
    : eq(schema.sessions.carId, car.id)

  const row = (await db
    .select({
      lap: schema.laps,
      sessionId: schema.sessions.id,
      eventId: schema.sessions.eventId
    })
    .from(schema.laps)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.laps.sessionId))
    .where(whereClause)
    .orderBy(asc(schema.laps.timeMs))
    .limit(1))[0]

  if (!row) return null

  const json = gunzipSync(row.lap.framesBlob).toString('utf8')
  const frames = JSON.parse(json) as unknown[]

  return {
    lapId: row.lap.id,
    lapNumber: row.lap.lapNumber,
    timeMs: row.lap.timeMs,
    sessionId: row.sessionId,
    eventId: row.eventId,
    frames
  }
})
