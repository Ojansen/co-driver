import { and, desc, eq, lt } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { decodeFrames } from '~~/server/utils/frames-codec'
import { binFrames } from '~~/app/utils/dyno'
import { summarizeTrailBraking } from '~~/app/utils/trail-braking'

/**
 * Auto-pair compare: given session X, find the most recent prior session Y
 * with the same (carId, eventId), and return both sides' measurements +
 * setup snapshots. No detection layer; just lap time, trail-brake summary
 * average, dyno peak, and the build/tune snapshots needed for the tune diff.
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
      carId: schema.sessions.carId,
      eventId: schema.sessions.eventId,
      startedAt: schema.sessions.startedAt,
      buildSnapshot: schema.sessions.buildSnapshot,
      tuneSnapshot: schema.sessions.tuneSnapshot,
      buildName: schema.builds.name,
      tuneName: schema.tunes.name
    })
    .from(schema.sessions)
    .leftJoin(schema.builds, eq(schema.builds.id, schema.sessions.buildId))
    .leftJoin(schema.tunes, eq(schema.tunes.id, schema.sessions.tuneId))
    .where(eq(schema.sessions.id, id))
    .limit(1))[0]

  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'session not found' })
  }

  // Find the most recent prior session on the same (carId, eventId).
  const prior = (await db
    .select({
      id: schema.sessions.id,
      startedAt: schema.sessions.startedAt,
      buildSnapshot: schema.sessions.buildSnapshot,
      tuneSnapshot: schema.sessions.tuneSnapshot,
      buildName: schema.builds.name,
      tuneName: schema.tunes.name
    })
    .from(schema.sessions)
    .leftJoin(schema.builds, eq(schema.builds.id, schema.sessions.buildId))
    .leftJoin(schema.tunes, eq(schema.tunes.id, schema.sessions.tuneId))
    .where(
      and(
        eq(schema.sessions.carId, session.carId),
        eq(schema.sessions.eventId, session.eventId),
        lt(schema.sessions.startedAt, session.startedAt)
      )
    )
    .orderBy(desc(schema.sessions.startedAt))
    .limit(1))[0]

  // Helper: compute measurements for a session id from its lap blobs.
  async function measureSession(sessionId: number) {
    const lapRows = await db
      .select({
        id: schema.laps.id,
        timeMs: schema.laps.timeMs,
        framesBlob: schema.laps.framesBlob
      })
      .from(schema.laps)
      .where(eq(schema.laps.sessionId, sessionId))

    let bestLapMs: number | null = null
    let trailBrakingRatioSum = 0
    let trailBrakingBrakingFrames = 0
    let peakPowerKw: number | null = null

    for (const lap of lapRows) {
      if (lap.timeMs > 0 && (bestLapMs === null || lap.timeMs < bestLapMs)) {
        bestLapMs = lap.timeMs
      }
      if (!lap.framesBlob) continue
      try {
        const frames = decodeFrames(lap.framesBlob)
        const tb = summarizeTrailBraking(frames)
        trailBrakingBrakingFrames += tb.brakingFrames
        trailBrakingRatioSum += tb.ratio * tb.brakingFrames // weighted sum
        // peak power across all laps
        const curve = binFrames(frames)
        const lapPeakKw = curve.peakPower?.value ?? null
        if (lapPeakKw !== null && (peakPowerKw === null || lapPeakKw > peakPowerKw)) {
          peakPowerKw = lapPeakKw
        }
      } catch (err) {
        console.error(`[compare] failed to read lap ${lap.id}:`, err)
      }
    }

    const avgTrailBrakingRatio = trailBrakingBrakingFrames > 0
      ? trailBrakingRatioSum / trailBrakingBrakingFrames
      : null

    return { bestLapMs, avgTrailBrakingRatio, peakPowerKw }
  }

  const currentMeasurements = await measureSession(session.id)
  const priorMeasurements = prior ? await measureSession(prior.id) : null

  return {
    current: {
      sessionId: session.id,
      buildSnapshot: session.buildSnapshot,
      tuneSnapshot: session.tuneSnapshot,
      buildName: session.buildName,
      tuneName: session.tuneName,
      ...currentMeasurements
    },
    prior: prior
      ? {
          sessionId: prior.id,
          startedAt: prior.startedAt,
          buildSnapshot: prior.buildSnapshot,
          tuneSnapshot: prior.tuneSnapshot,
          buildName: prior.buildName,
          tuneName: prior.tuneName,
          ...priorMeasurements
        }
      : null
  }
})
