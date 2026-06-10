import { and, eq, ne } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { eventType, type EventType } from '../../db/schema'

/**
 * Rename / re-tag an event (the U in CRUD). Body: `{ name?, type? }`.
 * - name: re-checked for (gameId, name) uniqueness within the event's game.
 * - type: optional discipline tag — null clears it; a string must be in the
 *   Forza enum. Both fields are optional; sending neither is a no-op.
 */
interface PatchBody {
  name?: unknown
  type?: unknown
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid event id' })
  }

  const existing = (await db.select().from(schema.events).where(eq(schema.events.id, id)).limit(1))[0]
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'event not found' })
  }

  const body = await readBody<PatchBody>(event)
  const updates: { name?: string, type?: EventType | null } = {}

  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      throw createError({ statusCode: 400, statusMessage: 'name must be a non-empty string' })
    }
    if (name !== existing.name) {
      const clash = (await db
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(and(eq(schema.events.gameId, existing.gameId), eq(schema.events.name, name), ne(schema.events.id, id)))
        .limit(1))[0]
      if (clash) {
        throw createError({ statusCode: 409, statusMessage: `an event named "${name}" already exists` })
      }
      updates.name = name
    }
  }

  if (body?.type !== undefined) {
    if (body.type === null) {
      updates.type = null
    } else if (typeof body.type === 'string' && (eventType as readonly string[]).includes(body.type)) {
      updates.type = body.type as EventType
    } else {
      throw createError({ statusCode: 400, statusMessage: `type must be null or one of: ${eventType.join(', ')}` })
    }
  }

  if (Object.keys(updates).length === 0) {
    return existing
  }

  const updated = (await db.update(schema.events).set(updates).where(eq(schema.events.id, id)).returning())[0]!
  return updated
})
