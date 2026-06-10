import { and, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'

interface CreateBody {
  ordinal?: unknown
  class?: unknown
}

// The garage is FH6-only (cars are namespaced per game; an ordinal is unique
// within a game). Manual car adds therefore live under FH6.
const GARAGE_GAME_ID = 'fh6'

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateBody>(event)

  const ordinal = Number(body?.ordinal)
  const carClass = Number(body?.class)

  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw createError({ statusCode: 400, statusMessage: 'ordinal must be a non-negative integer' })
  }
  if (!Number.isInteger(carClass) || carClass < 0 || carClass > 7) {
    throw createError({ statusCode: 400, statusMessage: 'class must be an integer 0–7' })
  }

  const existing = (await db
    .select()
    .from(schema.cars)
    .where(and(eq(schema.cars.gameId, GARAGE_GAME_ID), eq(schema.cars.ordinal, ordinal)))
    .limit(1))[0]
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'car already in garage' })
  }

  const created = (await db
    .insert(schema.cars)
    .values({ gameId: GARAGE_GAME_ID, ordinal, class: carClass })
    .returning())[0]!
  return created
})
