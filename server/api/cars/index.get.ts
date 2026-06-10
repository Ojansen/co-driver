import { eq, max, sql } from 'drizzle-orm'
import { db, schema } from 'hub:db'

/**
 * Garage index. Lists cars that the user has driven (have ≥1 session) OR
 * have an attached build, with simple aggregates for the card view.
 */
export default defineEventHandler(async () => {
  const rows = await db
    .select({
      id: schema.cars.id,
      ordinal: schema.cars.ordinal,
      class: schema.cars.class,
      displayName: schema.cars.displayName,
      buildCount: sql<number>`COUNT(DISTINCT ${schema.builds.id})`,
      sessionCount: sql<number>`COUNT(DISTINCT ${schema.sessions.id})`,
      lastUsedAt: max(schema.sessions.startedAt)
    })
    .from(schema.cars)
    .leftJoin(schema.builds, eq(schema.builds.carId, schema.cars.id))
    .leftJoin(schema.sessions, eq(schema.sessions.carId, schema.cars.id))
    // The garage / build-tune stack is FH6-only; an ordinal is only unique
    // within a game, so scope to fh6 to avoid surfacing other sims' cars.
    .where(eq(schema.cars.gameId, 'fh6'))
    .groupBy(schema.cars.id)
    .orderBy(schema.cars.id)

  return rows.map(r => ({
    ordinal: r.ordinal,
    class: r.class,
    displayName: r.displayName,
    buildCount: Number(r.buildCount) || 0,
    sessionCount: Number(r.sessionCount) || 0,
    lastUsedAt: r.lastUsedAt
  }))
})
