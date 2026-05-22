import { gunzipSync } from 'node:zlib'
import { asc, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import type { Telemetry } from '~~/server/utils/decode'
import { computeSectorTimes, DEFAULT_SECTOR_COUNT } from '~~/app/utils/sectors'

/**
 * Per-lap sector times for a session. Mirrors the trail-braking endpoint
 * pattern: gunzip each lap blob, summarize, return a small JSON.
 *
 * `sectorTimes: null` is the explicit "lap too short or corrupt" signal;
 * the UI renders dash placeholders for those rows.
 */
export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid session id' })
  }

  const session = (await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1))[0]

  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'session not found' })
  }

  const lapRows = await db
    .select({
      id: schema.laps.id,
      lapNumber: schema.laps.lapNumber,
      framesBlob: schema.laps.framesBlob
    })
    .from(schema.laps)
    .where(eq(schema.laps.sessionId, id))
    .orderBy(asc(schema.laps.lapNumber))

  const laps: Array<{ lapNumber: number, sectorTimes: number[] | null }> = []
  for (const lap of lapRows) {
    if (!lap.framesBlob) {
      laps.push({ lapNumber: lap.lapNumber, sectorTimes: null })
      continue
    }
    try {
      const frames = JSON.parse(gunzipSync(lap.framesBlob).toString('utf8')) as Telemetry[]
      laps.push({
        lapNumber: lap.lapNumber,
        sectorTimes: computeSectorTimes(frames)
      })
    } catch (err) {
      console.error(`[sectors] failed to read lap ${lap.id}:`, err)
      laps.push({ lapNumber: lap.lapNumber, sectorTimes: null })
    }
  }

  return { sessionId: session.id, sectorCount: DEFAULT_SECTOR_COUNT, laps }
})
