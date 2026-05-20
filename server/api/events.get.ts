import { asc, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { eventType, type EventType } from '../db/schema'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const typeFilter = typeof query.type === 'string' ? query.type as EventType : null

  if (typeFilter && !(eventType as readonly string[]).includes(typeFilter)) {
    throw createError({ statusCode: 400, statusMessage: `unknown event type: ${typeFilter}` })
  }

  const rows = await db
    .select()
    .from(schema.events)
    .where(typeFilter ? eq(schema.events.type, typeFilter) : undefined)
    .orderBy(asc(schema.events.type), asc(schema.events.name))

  return rows
})
