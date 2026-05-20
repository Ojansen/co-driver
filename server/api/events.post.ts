import { and, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { eventType, type EventType } from '../db/schema'

interface CreateBody {
  name?: unknown
  type?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateBody>(event)

  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const type = body?.type

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'name required' })
  }
  if (typeof type !== 'string' || !(eventType as readonly string[]).includes(type)) {
    throw createError({
      statusCode: 400,
      statusMessage: `type must be one of: ${eventType.join(', ')}`
    })
  }
  const typedType = type as EventType

  const existing = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.name, name), eq(schema.events.type, typedType)))
    .limit(1)
  if (existing.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `an event named "${name}" already exists for type "${type}"`
    })
  }

  const created = await db
    .insert(schema.events)
    .values({ name, type: typedType })
    .returning()
  return created[0]!
})
