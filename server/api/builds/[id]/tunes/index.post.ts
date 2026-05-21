import { eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'

interface PostBody {
  name?: unknown
  settings?: unknown
}

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const buildId = Number(idParam)
  if (!Number.isInteger(buildId) || buildId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid build id' })
  }

  const body = await readBody<PostBody>(event)
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name required' })
  }
  const name = body.name.trim()
  const settings = body.settings && typeof body.settings === 'object' ? body.settings : {}

  const build = (await db
    .select({ id: schema.builds.id })
    .from(schema.builds)
    .where(eq(schema.builds.id, buildId))
    .limit(1))[0]

  if (!build) {
    throw createError({ statusCode: 404, statusMessage: 'build not found' })
  }

  try {
    const inserted = await db
      .insert(schema.tunes)
      .values({ buildId, name, settings })
      .returning()

    return inserted[0]!
  } catch (err) {
    const e = err as { message?: string }
    if (e.message?.includes('UNIQUE')) {
      throw createError({ statusCode: 409, statusMessage: 'tune name already exists for this build' })
    }
    throw err
  }
})
