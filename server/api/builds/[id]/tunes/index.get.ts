import { asc, eq, sql } from 'drizzle-orm'
import { db, schema } from 'hub:db'

/**
 * List tunes for a build, with session-count aggregate.
 * Endpoint param is `id` (the buildId) for consistency with the rest of /api/builds/[id].
 */
export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const buildId = Number(idParam)
  if (!Number.isInteger(buildId) || buildId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid build id' })
  }

  const build = (await db
    .select({ id: schema.builds.id })
    .from(schema.builds)
    .where(eq(schema.builds.id, buildId))
    .limit(1))[0]

  if (!build) {
    throw createError({ statusCode: 404, statusMessage: 'build not found' })
  }

  const rows = await db
    .select({
      id: schema.tunes.id,
      name: schema.tunes.name,
      createdAt: schema.tunes.createdAt,
      sessionCount: sql<number>`(SELECT COUNT(*) FROM ${schema.sessions} WHERE ${schema.sessions.tuneId} = ${schema.tunes.id})`
    })
    .from(schema.tunes)
    .where(eq(schema.tunes.buildId, buildId))
    .orderBy(asc(schema.tunes.createdAt))

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    sessionCount: Number(r.sessionCount) || 0
  }))
})
