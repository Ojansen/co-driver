import { and, asc, eq, max, sql } from 'drizzle-orm'
import { db, schema } from 'hub:db'

/**
 * List a car's builds with build-level aggregates. Used by the car-detail
 * page and the build picker on session-detail.
 */
export default defineEventHandler(async (event) => {
  const ordinalParam = getRouterParam(event, 'ordinal')
  const ordinal = Number(ordinalParam)
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid car ordinal' })
  }

  const car = (await db
    .select({ id: schema.cars.id })
    .from(schema.cars)
    .where(and(eq(schema.cars.gameId, 'fh6'), eq(schema.cars.ordinal, ordinal)))
    .limit(1))[0]

  if (!car) return []

  const rows = await db
    .select({
      id: schema.builds.id,
      name: schema.builds.name,
      createdAt: schema.builds.createdAt,
      tuneCount: sql<number>`COUNT(DISTINCT ${schema.tunes.id})`,
      sessionCount: sql<number>`COUNT(DISTINCT ${schema.sessions.id})`,
      lastUsedAt: max(schema.sessions.startedAt)
    })
    .from(schema.builds)
    .leftJoin(schema.tunes, eq(schema.tunes.buildId, schema.builds.id))
    .leftJoin(schema.sessions, eq(schema.sessions.buildId, schema.builds.id))
    .where(eq(schema.builds.carId, car.id))
    .groupBy(schema.builds.id)
    .orderBy(asc(schema.builds.createdAt))

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    tuneCount: Number(r.tuneCount) || 0,
    sessionCount: Number(r.sessionCount) || 0,
    lastUsedAt: r.lastUsedAt
  }))
})
