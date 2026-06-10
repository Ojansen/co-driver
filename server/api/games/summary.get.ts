import { sql } from 'drizzle-orm'
import { db, schema } from 'hub:db'

/**
 * Per-game activity rollup for the game-grid landing (the workspace picker).
 * One grouped pass over sessions → recordings/cars/last-driven per game. No
 * per-game filter: the grid shows every workspace's activity at a glance.
 *
 * Uses raw SQL aggregates (MAX(startedAt) returns unixepoch seconds, mirroring
 * events.get.ts) and normalises lastAt to an ISO string for the client.
 */
export default defineEventHandler(async () => {
  const rows = await db
    .select({
      gameId: schema.sessions.gameId,
      sessionCount: sql<number>`COUNT(${schema.sessions.id})`,
      carCount: sql<number>`COUNT(DISTINCT ${schema.sessions.carId})`,
      lastAt: sql<number | null>`MAX(${schema.sessions.startedAt})`
    })
    .from(schema.sessions)
    .groupBy(schema.sessions.gameId)

  return rows.map(r => ({
    gameId: r.gameId,
    sessionCount: Number(r.sessionCount) || 0,
    carCount: Number(r.carCount) || 0,
    lastAt: r.lastAt != null ? new Date(r.lastAt * 1000).toISOString() : null
  }))
})
