import { eq, inArray } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { recorder } from '~~/server/utils/recorder'

export default defineEventHandler(async (event) => {
  const ordinalParam = getRouterParam(event, 'ordinal')
  const ordinal = Number(ordinalParam)
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid car ordinal' })
  }

  const existing = (await db
    .select({ id: schema.cars.id })
    .from(schema.cars)
    .where(eq(schema.cars.ordinal, ordinal))
    .limit(1))[0]
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'car not found' })
  }
  const carId = existing.id

  const state = recorder.getState()
  if (state.state === 'recording' && state.carOrdinal === ordinal) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cannot delete car while recording with it. Stop the recording first.'
    })
  }

  let sessionsRemoved = 0
  let lapsRemoved = 0
  let buildsRemoved = 0
  let tunesRemoved = 0

  await db.transaction(async (tx) => {
    const sessionRows = await tx
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.carId, carId))
    const sessionIds = sessionRows.map(r => r.id)
    sessionsRemoved = sessionIds.length

    if (sessionIds.length > 0) {
      const deletedLaps = await tx
        .delete(schema.laps)
        .where(inArray(schema.laps.sessionId, sessionIds))
        .returning({ id: schema.laps.id })
      lapsRemoved = deletedLaps.length

      await tx.delete(schema.sessions).where(eq(schema.sessions.carId, carId))
    }

    const buildRows = await tx
      .select({ id: schema.builds.id })
      .from(schema.builds)
      .where(eq(schema.builds.carId, carId))
    const buildIds = buildRows.map(r => r.id)
    buildsRemoved = buildIds.length

    if (buildIds.length > 0) {
      const deletedTunes = await tx
        .delete(schema.tunes)
        .where(inArray(schema.tunes.buildId, buildIds))
        .returning({ id: schema.tunes.id })
      tunesRemoved = deletedTunes.length

      await tx.delete(schema.builds).where(eq(schema.builds.carId, carId))
    }

    await tx.delete(schema.cars).where(eq(schema.cars.id, carId))
  })

  return { deleted: true, sessionsRemoved, lapsRemoved, buildsRemoved, tunesRemoved }
})
