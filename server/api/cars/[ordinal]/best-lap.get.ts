import { and, asc, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { DEFAULT_GAME_ID, isGameId } from '#shared/games'
import { decodeFrames } from '~~/server/utils/frames-codec'

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
  // Cars are namespaced per game; scope to the active game (default fh6) so the
  // hotlap PB reference resolves for every sim, not just Forza.
  const gameId = typeof query.gameId === 'string' && isGameId(query.gameId) ? query.gameId : DEFAULT_GAME_ID

  const car = (await db.select().from(schema.cars)
    .where(and(eq(schema.cars.gameId, gameId), eq(schema.cars.ordinal, ordinal))).limit(1))[0]
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

  const frames = decodeFrames(row.lap.framesBlob)

  return {
    lapId: row.lap.id,
    lapNumber: row.lap.lapNumber,
    timeMs: row.lap.timeMs,
    sessionId: row.sessionId,
    eventId: row.eventId,
    frames
  }
})
