import { eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'

/**
 * Delete a tune. Any sessions that referenced it have their `tuneId` nulled —
 * the session's `tuneSnapshot` column already preserves the tune settings at
 * recording time, so the historical data stays intact (compare / replay still
 * works). Only the live FK is cleared.
 */
export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const tuneId = Number(idParam)
  if (!Number.isInteger(tuneId) || tuneId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid tune id' })
  }

  const existing = (await db
    .select({ id: schema.tunes.id })
    .from(schema.tunes)
    .where(eq(schema.tunes.id, tuneId))
    .limit(1))[0]
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'tune not found' })
  }

  let sessionsUnlinked = 0

  await db.transaction(async (tx) => {
    const unlinked = await tx
      .update(schema.sessions)
      .set({ tuneId: null })
      .where(eq(schema.sessions.tuneId, tuneId))
      .returning({ id: schema.sessions.id })
    sessionsUnlinked = unlinked.length

    await tx.delete(schema.tunes).where(eq(schema.tunes.id, tuneId))
  })

  return { deleted: true, sessionsUnlinked }
})
