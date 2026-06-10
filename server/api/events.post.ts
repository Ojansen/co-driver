import { and, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { DEFAULT_GAME_ID, isGameId } from '#shared/games'
import { eventType, type EventType } from '../db/schema'

interface CreateBody {
  name?: unknown
  type?: unknown
  gameId?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateBody>(event)

  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  // The game this event belongs to. Omitted → FH6 (back-compat).
  const gameId = isGameId(body?.gameId) ? body.gameId : DEFAULT_GAME_ID

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'name required' })
  }

  // `type` is an OPTIONAL discipline tag (Forza-Horizon taxonomy). Validate it
  // only when given; other sims omit it entirely (→ null).
  let type: EventType | null = null
  if (body?.type != null) {
    if (typeof body.type !== 'string' || !(eventType as readonly string[]).includes(body.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: `type, if given, must be one of: ${eventType.join(', ')}`
      })
    }
    type = body.type as EventType
  }

  // Identity is (gameId, name) — one event per track/race per game.
  const existing = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.gameId, gameId), eq(schema.events.name, name)))
    .limit(1)
  if (existing.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `an event named "${name}" already exists`
    })
  }

  const created = await db
    .insert(schema.events)
    .values({ gameId, name, type })
    .returning()
  return created[0]!
})
