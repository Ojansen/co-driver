import { and, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'

interface PatchBody {
  displayName?: unknown
}

export default defineEventHandler(async (event) => {
  const ordinalParam = getRouterParam(event, 'ordinal')
  const ordinal = Number(ordinalParam)
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid car ordinal' })
  }

  const body = await readBody<PatchBody>(event)
  if (!body || !('displayName' in body)) {
    throw createError({ statusCode: 400, statusMessage: 'no fields to update' })
  }

  let displayName: string | null
  if (body.displayName === null) {
    displayName = null
  } else if (typeof body.displayName === 'string') {
    const trimmed = body.displayName.trim()
    displayName = trimmed.length ? trimmed : null
  } else {
    throw createError({ statusCode: 400, statusMessage: 'displayName must be a string or null' })
  }

  const updated = await db
    .update(schema.cars)
    .set({ displayName })
    .where(and(eq(schema.cars.gameId, 'fh6'), eq(schema.cars.ordinal, ordinal)))
    .returning()

  if (updated.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'car not found' })
  }
  return updated[0]!
})
