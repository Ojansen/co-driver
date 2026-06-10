import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { isGameId } from '#shared/games'

/**
 * Every recorded session with its car + event context and a thin lap list,
 * newest first. Feeds the Transfer page, which groups these by car and exposes
 * per-lap export. Laps are fetched in one batched query and grouped in JS to
 * avoid the row fan-out of a session⋈lap join.
 *
 * Scoped to the active game (workspace) via ?gameId; omitted → all games.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const gameFilter = typeof query.gameId === 'string' && isGameId(query.gameId) ? query.gameId : null

  const sessions = await db
    .select({
      sessionId: schema.sessions.id,
      gameId: schema.sessions.gameId,
      carId: schema.sessions.carId,
      carOrdinal: schema.cars.ordinal,
      carClass: schema.cars.class,
      carDisplayName: schema.cars.displayName,
      eventId: schema.sessions.eventId,
      eventName: schema.events.name,
      eventType: schema.events.type,
      tuneLabel: schema.sessions.tuneLabel,
      piAtStart: schema.sessions.piAtStart,
      startedAt: schema.sessions.startedAt,
      endedAt: schema.sessions.endedAt
    })
    .from(schema.sessions)
    .innerJoin(schema.events, eq(schema.events.id, schema.sessions.eventId))
    .innerJoin(schema.cars, eq(schema.cars.id, schema.sessions.carId))
    .where(gameFilter ? eq(schema.sessions.gameId, gameFilter) : undefined)
    .orderBy(desc(schema.sessions.startedAt))

  if (sessions.length === 0) return []

  const lapRows = await db
    .select({
      id: schema.laps.id,
      sessionId: schema.laps.sessionId,
      lapNumber: schema.laps.lapNumber,
      timeMs: schema.laps.timeMs
    })
    .from(schema.laps)
    .where(inArray(schema.laps.sessionId, sessions.map(s => s.sessionId)))
    .orderBy(asc(schema.laps.lapNumber))

  const lapsBySession = new Map<number, typeof lapRows>()
  for (const lap of lapRows) {
    const list = lapsBySession.get(lap.sessionId) ?? []
    list.push(lap)
    lapsBySession.set(lap.sessionId, list)
  }

  return sessions.map(s => ({
    ...s,
    laps: (lapsBySession.get(s.sessionId) ?? []).map(({ id, lapNumber, timeMs }) => ({ id, lapNumber, timeMs }))
  }))
})
