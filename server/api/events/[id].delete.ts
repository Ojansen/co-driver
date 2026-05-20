import { eq, inArray } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { recorder } from '~~/server/utils/recorder'

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid event id' })
  }

  const existing = (await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .limit(1))[0]
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'event not found' })
  }

  const state = recorder.getState()
  if (state.state === 'recording' && state.eventId === id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cannot delete event while recording. Stop the recording first.'
    })
  }

  let sessionsRemoved = 0
  let lapsRemoved = 0

  await db.transaction(async (tx) => {
    const sessionRows = await tx
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.eventId, id))
    const sessionIds = sessionRows.map(r => r.id)
    sessionsRemoved = sessionIds.length

    if (sessionIds.length > 0) {
      const deletedLaps = await tx
        .delete(schema.laps)
        .where(inArray(schema.laps.sessionId, sessionIds))
        .returning({ id: schema.laps.id })
      lapsRemoved = deletedLaps.length

      await tx.delete(schema.sessions).where(eq(schema.sessions.eventId, id))
    }

    await tx.delete(schema.events).where(eq(schema.events.id, id))
  })

  return { deleted: true, sessionsRemoved, lapsRemoved }
})
