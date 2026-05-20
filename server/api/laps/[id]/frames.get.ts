import { gunzipSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid lap id' })
  }

  const row = (await db
    .select({
      lap: schema.laps,
      sessionId: schema.sessions.id,
      eventId: schema.sessions.eventId,
      tuneLabel: schema.sessions.tuneLabel,
      piAtStart: schema.sessions.piAtStart,
      carOrdinal: schema.cars.ordinal,
      carClass: schema.cars.class,
      carDisplayName: schema.cars.displayName
    })
    .from(schema.laps)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.laps.sessionId))
    .innerJoin(schema.cars, eq(schema.cars.id, schema.sessions.carId))
    .where(eq(schema.laps.id, id))
    .limit(1))[0]

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'lap not found' })
  }

  const json = gunzipSync(row.lap.framesBlob).toString('utf8')
  const frames = JSON.parse(json) as unknown[]

  return {
    lapId: row.lap.id,
    lapNumber: row.lap.lapNumber,
    timeMs: row.lap.timeMs,
    sessionId: row.sessionId,
    eventId: row.eventId,
    tuneLabel: row.tuneLabel,
    piAtStart: row.piAtStart,
    carOrdinal: row.carOrdinal,
    carClass: row.carClass,
    carDisplayName: row.carDisplayName,
    frames
  }
})
