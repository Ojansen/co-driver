import { eq, inArray } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { recorder } from '~~/server/utils/recorder'

/**
 * Delete a build. Its tunes are removed along with it (a tune cannot exist
 * without its parent build). Any sessions that referenced the build — or one of
 * its tunes — have their `buildId` / `tuneId` nulled: the per-session
 * `buildSnapshot` / `tuneSnapshot` columns already preserve the settings at
 * recording time, so the historical data stays intact (laps / compare / replay
 * still work). Only the live FKs are cleared.
 */
export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const buildId = Number(idParam)
  if (!Number.isInteger(buildId) || buildId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid build id' })
  }

  const existing = (await db
    .select({ id: schema.builds.id })
    .from(schema.builds)
    .where(eq(schema.builds.id, buildId))
    .limit(1))[0]
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'build not found' })
  }

  // Refuse while the live recording is capturing into this build — deleting it
  // mid-session would yank the FK out from under the in-flight session.
  const state = recorder.getState()
  if (state.state === 'recording') {
    const liveSession = (await db
      .select({ buildId: schema.sessions.buildId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, state.sessionId))
      .limit(1))[0]
    if (liveSession?.buildId === buildId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Cannot delete build while recording with it. Stop the recording first.'
      })
    }
  }

  let tunesRemoved = 0
  let sessionsUnlinked = 0

  await db.transaction(async (tx) => {
    const tuneRows = await tx
      .select({ id: schema.tunes.id })
      .from(schema.tunes)
      .where(eq(schema.tunes.buildId, buildId))
    const tuneIds = tuneRows.map(r => r.id)

    if (tuneIds.length > 0) {
      await tx
        .update(schema.sessions)
        .set({ tuneId: null })
        .where(inArray(schema.sessions.tuneId, tuneIds))
    }

    const unlinked = await tx
      .update(schema.sessions)
      .set({ buildId: null })
      .where(eq(schema.sessions.buildId, buildId))
      .returning({ id: schema.sessions.id })
    sessionsUnlinked = unlinked.length

    const deletedTunes = await tx
      .delete(schema.tunes)
      .where(eq(schema.tunes.buildId, buildId))
      .returning({ id: schema.tunes.id })
    tunesRemoved = deletedTunes.length

    await tx.delete(schema.builds).where(eq(schema.builds.id, buildId))
  })

  return { deleted: true, tunesRemoved, sessionsUnlinked }
})
