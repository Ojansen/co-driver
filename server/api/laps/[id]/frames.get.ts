import { eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { decodeFrames } from '~~/server/utils/frames-codec'

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
      buildSnapshot: schema.sessions.buildSnapshot,
      tuneSnapshot: schema.sessions.tuneSnapshot,
      buildName: schema.builds.name,
      tuneName: schema.tunes.name,
      carOrdinal: schema.cars.ordinal,
      carClass: schema.cars.class,
      carDisplayName: schema.cars.displayName
    })
    .from(schema.laps)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.laps.sessionId))
    .innerJoin(schema.cars, eq(schema.cars.id, schema.sessions.carId))
    .leftJoin(schema.builds, eq(schema.builds.id, schema.sessions.buildId))
    .leftJoin(schema.tunes, eq(schema.tunes.id, schema.sessions.tuneId))
    .where(eq(schema.laps.id, id))
    .limit(1))[0]

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'lap not found' })
  }

  const frames = decodeFrames(row.lap.framesBlob)

  return {
    lapId: row.lap.id,
    lapNumber: row.lap.lapNumber,
    timeMs: row.lap.timeMs,
    sessionId: row.sessionId,
    eventId: row.eventId,
    tuneLabel: row.tuneLabel,
    piAtStart: row.piAtStart,
    buildSnapshot: row.buildSnapshot,
    tuneSnapshot: row.tuneSnapshot,
    buildName: row.buildName,
    tuneName: row.tuneName,
    carOrdinal: row.carOrdinal,
    carClass: row.carClass,
    carDisplayName: row.carDisplayName,
    frames
  }
})
