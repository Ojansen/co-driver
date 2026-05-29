import { asc, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import type { Telemetry } from '~~/server/utils/decode'
import { decodeFrames } from '~~/server/utils/frames-codec'
import { binFrames } from '~~/app/utils/dyno'

/**
 * Server-side dyno aggregation: read every lap blob for the session, unzip,
 * bin frames, return a small DynoCurve JSON. Cheaper than streaming raw frames
 * to the browser (~36MB for a 5-lap session) — the curve is <1KB.
 */
export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid session id' })
  }

  const session = (await db
    .select({
      id: schema.sessions.id,
      eventId: schema.sessions.eventId,
      tuneLabel: schema.sessions.tuneLabel,
      piAtStart: schema.sessions.piAtStart,
      carOrdinal: schema.cars.ordinal,
      carClass: schema.cars.class,
      carDisplayName: schema.cars.displayName
    })
    .from(schema.sessions)
    .innerJoin(schema.cars, eq(schema.cars.id, schema.sessions.carId))
    .where(eq(schema.sessions.id, id))
    .limit(1))[0]

  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'session not found' })
  }

  const lapRows = await db
    .select({ id: schema.laps.id, framesBlob: schema.laps.framesBlob })
    .from(schema.laps)
    .where(eq(schema.laps.sessionId, id))
    .orderBy(asc(schema.laps.lapNumber))

  // Unzip and concatenate frames across all laps. Each blob is gzipped
  // JSON-serialised Telemetry[]. Single-pass: gunzip, parse, push.
  const allFrames: Telemetry[] = []
  for (const lap of lapRows) {
    if (!lap.framesBlob) continue
    try {
      const frames = decodeFrames(lap.framesBlob)
      for (const f of frames) allFrames.push(f)
    } catch (err) {
      console.error(`[dyno] failed to unzip lap ${lap.id}:`, err)
    }
  }

  const curve = binFrames(allFrames)

  return {
    sessionId: session.id,
    eventId: session.eventId,
    tuneLabel: session.tuneLabel,
    piAtStart: session.piAtStart,
    car: {
      ordinal: session.carOrdinal,
      class: session.carClass,
      displayName: session.carDisplayName
    },
    lapCount: lapRows.length,
    curve
  }
})
