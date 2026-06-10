import { and, asc, eq, sql } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { isGameId } from '#shared/games'
import { eventType, type EventType } from '../db/schema'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const typeFilter = typeof query.type === 'string' ? query.type as EventType : null
  // Scope to the active game (workspace). Omitted → all games (back-compat).
  const gameFilter = typeof query.gameId === 'string' && isGameId(query.gameId) ? query.gameId : null

  if (typeFilter && !(eventType as readonly string[]).includes(typeFilter)) {
    throw createError({ statusCode: 400, statusMessage: `unknown event type: ${typeFilter}` })
  }

  const conditions = [
    typeFilter ? eq(schema.events.type, typeFilter) : undefined,
    gameFilter ? eq(schema.events.gameId, gameFilter) : undefined
  ].filter(Boolean)

  const rows = await db
    .select({
      id: schema.events.id,
      gameId: schema.events.gameId,
      name: schema.events.name,
      type: schema.events.type,
      createdAt: schema.events.createdAt,
      bestLapMs: sql<number | null>`MIN(${schema.laps.timeMs})`.as('bestLapMs'),
      lastDrivenAt: sql<number | null>`MAX(${schema.sessions.startedAt})`.as('lastDrivenAt')
    })
    .from(schema.events)
    .leftJoin(schema.sessions, eq(schema.sessions.eventId, schema.events.id))
    .leftJoin(schema.laps, eq(schema.laps.sessionId, schema.sessions.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(schema.events.id)
    .orderBy(asc(schema.events.name))

  return rows
})
