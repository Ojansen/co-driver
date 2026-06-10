import { and, eq, isNotNull } from 'drizzle-orm'
import { db, schema } from 'hub:db'

export default defineEventHandler(async (event) => {
  const ordinalParam = getRouterParam(event, 'ordinal')
  const ordinal = Number(ordinalParam)
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid car ordinal' })
  }

  const rows = await db
    .selectDistinct({ tuneLabel: schema.sessions.tuneLabel })
    .from(schema.sessions)
    .innerJoin(schema.cars, eq(schema.cars.id, schema.sessions.carId))
    .where(and(eq(schema.cars.gameId, 'fh6'), eq(schema.cars.ordinal, ordinal), isNotNull(schema.sessions.tuneLabel)))

  return rows.map(r => r.tuneLabel).filter((s): s is string => typeof s === 'string')
})
