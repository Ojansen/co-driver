import { eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { recorder } from '~~/server/utils/recorder'

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid session id' })
  }

  const existing = (await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1))[0]
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'session not found' })
  }

  const state = recorder.getState()
  if (state.state === 'recording' && state.sessionId === id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cannot delete the actively recording session. Stop the recording first.'
    })
  }

  let lapsRemoved = 0

  await db.transaction(async (tx) => {
    const deletedLaps = await tx
      .delete(schema.laps)
      .where(eq(schema.laps.sessionId, id))
      .returning({ id: schema.laps.id })
    lapsRemoved = deletedLaps.length

    await tx.delete(schema.sessions).where(eq(schema.sessions.id, id))
  })

  return { deleted: true, lapsRemoved }
})
