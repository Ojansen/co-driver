import { eq, sql } from 'drizzle-orm'
import { db, schema } from 'hub:db'

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid tune id' })
  }

  const row = (await db
    .select({
      id: schema.tunes.id,
      buildId: schema.tunes.buildId,
      buildName: schema.builds.name,
      carId: schema.builds.carId,
      carOrdinal: schema.cars.ordinal,
      carDisplayName: schema.cars.displayName,
      name: schema.tunes.name,
      settings: schema.tunes.settings,
      createdAt: schema.tunes.createdAt,
      sessionCount: sql<number>`(SELECT COUNT(*) FROM ${schema.sessions} WHERE ${schema.sessions.tuneId} = ${schema.tunes.id})`
    })
    .from(schema.tunes)
    .innerJoin(schema.builds, eq(schema.builds.id, schema.tunes.buildId))
    .innerJoin(schema.cars, eq(schema.cars.id, schema.builds.carId))
    .where(eq(schema.tunes.id, id))
    .limit(1))[0]

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'tune not found' })
  }

  return {
    ...row,
    sessionCount: Number(row.sessionCount) || 0
  }
})
