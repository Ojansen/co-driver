import { eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'

interface PatchBody {
  name?: unknown
  settings?: unknown
}

/**
 * Edit a tune. Updating the tune row does NOT mutate any historical session
 * snapshots — those are immutable per-session copies.
 */
export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid tune id' })
  }

  const body = await readBody<PatchBody>(event)
  if (!body) {
    throw createError({ statusCode: 400, statusMessage: 'body required' })
  }

  const updates: Partial<typeof schema.tunes.$inferInsert> = {}

  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw createError({ statusCode: 400, statusMessage: 'name must be a non-empty string' })
    }
    updates.name = body.name.trim()
  }
  if ('settings' in body) {
    if (body.settings === null || typeof body.settings !== 'object') {
      throw createError({ statusCode: 400, statusMessage: 'settings must be an object' })
    }
    updates.settings = body.settings
  }

  if (Object.keys(updates).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'no fields to update' })
  }

  try {
    const updated = await db
      .update(schema.tunes)
      .set(updates)
      .where(eq(schema.tunes.id, id))
      .returning()

    if (updated.length === 0) {
      throw createError({ statusCode: 404, statusMessage: 'tune not found' })
    }
    return updated[0]!
  } catch (err) {
    const e = err as { message?: string, statusCode?: number }
    if (e.statusCode) throw err
    if (e.message?.includes('UNIQUE')) {
      throw createError({ statusCode: 409, statusMessage: 'tune name already exists for this build' })
    }
    throw err
  }
})
