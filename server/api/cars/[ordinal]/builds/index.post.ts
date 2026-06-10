import { and, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'

interface PostBody {
  name?: unknown
  settings?: unknown
}

export default defineEventHandler(async (event) => {
  const ordinalParam = getRouterParam(event, 'ordinal')
  const ordinal = Number(ordinalParam)
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid car ordinal' })
  }

  const body = await readBody<PostBody>(event)
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name required' })
  }
  const name = body.name.trim()
  const settings = body.settings && typeof body.settings === 'object' ? body.settings : {}

  const car = (await db
    .select({ id: schema.cars.id })
    .from(schema.cars)
    .where(and(eq(schema.cars.gameId, 'fh6'), eq(schema.cars.ordinal, ordinal)))
    .limit(1))[0]

  if (!car) {
    throw createError({ statusCode: 404, statusMessage: 'car not found' })
  }

  try {
    const inserted = await db
      .insert(schema.builds)
      .values({ carId: car.id, name, settings })
      .returning()

    return inserted[0]!
  } catch (err) {
    const e = err as { message?: string }
    if (e.message?.includes('UNIQUE')) {
      throw createError({ statusCode: 409, statusMessage: 'build name already exists for this car' })
    }
    throw err
  }
})
