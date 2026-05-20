import { gunzipSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid lap id' })
  }

  const lap = (await db
    .select()
    .from(schema.laps)
    .where(eq(schema.laps.id, id))
    .limit(1))[0]

  if (!lap) {
    throw createError({ statusCode: 404, statusMessage: 'lap not found' })
  }

  const json = gunzipSync(lap.framesBlob).toString('utf8')
  const frames = JSON.parse(json) as unknown[]

  return {
    lapId: lap.id,
    lapNumber: lap.lapNumber,
    timeMs: lap.timeMs,
    frames
  }
})
