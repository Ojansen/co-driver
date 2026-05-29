import { asc, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { decodeFrames } from '~~/server/utils/frames-codec'
import { summarizeTrailBraking } from '~~/app/utils/trail-braking'

/**
 * Per-lap trail-braking summary for a session. Mirrors the dyno/path
 * endpoint pattern: gunzip each lap blob, summarize, return a small JSON.
 * Payload is a handful of numbers per lap.
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

  const laps: Array<{
    lapNumber: number
    ratio: number
    events: number
    brakingFrames: number
    trailBrakingFrames: number
  }> = []

  for (const lap of lapRows) {
    if (!lap.framesBlob) continue
    try {
      const frames = decodeFrames(lap.framesBlob)
      const s = summarizeTrailBraking(frames)
      laps.push({
        lapNumber: lap.lapNumber,
        ratio: s.ratio,
        events: s.events,
        brakingFrames: s.brakingFrames,
        trailBrakingFrames: s.trailBrakingFrames
      })
    } catch (err) {
      console.error(`[trail-braking] failed to unzip lap ${lap.id}:`, err)
    }
  }

  return { sessionId: session.id, laps }
})
