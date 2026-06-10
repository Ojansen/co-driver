import { and, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { DEFAULT_GAME_ID, isGameId } from '#shared/games'
import { eventType, type EventType } from '../../db/schema'
import { BUNDLE_FORMAT, BUNDLE_VERSION } from '~~/server/utils/lap-export'

/**
 * Import a single-lap co-driver bundle (the `bundle` format from
 * /api/laps/[id]/export). Merges by identity: cars dedupe on (gameId,ordinal),
 * events on (gameId,name) — the bundle's optional `type` is only applied when
 * creating a new event, not when reusing an existing one — builds on
 * (carId,name), tunes on (buildId,name), sessions on (eventId,carId,startedAt),
 * and the lap on (sessionId,lapNumber). Anything
 * already present is reused, not duplicated, so re-importing the same bundle is
 * idempotent. The frames blob is written back verbatim — it was carried base64
 * and never re-encoded.
 */
interface Bundle {
  format?: unknown
  version?: unknown
  gameId?: unknown
  event?: { name?: unknown, type?: unknown }
  car?: { ordinal?: unknown, class?: unknown, displayName?: unknown }
  build?: { name?: unknown, settings?: unknown } | null
  tune?: { name?: unknown, settings?: unknown } | null
  session?: {
    tuneLabel?: unknown
    piAtStart?: unknown
    startedAt?: unknown
    endedAt?: unknown
    buildSnapshot?: unknown
    tuneSnapshot?: unknown
  }
  lap?: { lapNumber?: unknown, timeMs?: unknown, framesB64?: unknown }
}

function bad(msg: string): never {
  throw createError({ statusCode: 400, statusMessage: msg })
}

function toDate(v: unknown, field: string): Date {
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(String(v))
  if (Number.isNaN(d.getTime())) bad(`invalid ${field}`)
  return d
}

export default defineEventHandler(async (event) => {
  const b = await readBody<Bundle>(event)

  if (!b || typeof b !== 'object') bad('expected a JSON bundle')
  if (b.format !== BUNDLE_FORMAT) bad(`unsupported format (expected "${BUNDLE_FORMAT}")`)
  if (b.version !== BUNDLE_VERSION) bad(`unsupported bundle version (expected ${BUNDLE_VERSION})`)

  const ev = b.event
  if (!ev || typeof ev.name !== 'string' || !ev.name.trim()) bad('event.name required')
  // `type` is an optional discipline tag; validate only when present.
  let evType: EventType | null = null
  if (ev.type != null) {
    if (typeof ev.type !== 'string' || !(eventType as readonly string[]).includes(ev.type)) {
      bad(`event.type, if given, must be one of: ${eventType.join(', ')}`)
    }
    evType = ev.type as EventType
  }
  const eventName = ev.name.trim()
  // Legacy bundles (exported before multi-game) carry no gameId → FH6.
  const gameId = isGameId(b.gameId) ? b.gameId : DEFAULT_GAME_ID

  const car = b.car
  if (!car || !Number.isInteger(car.ordinal) || !Number.isInteger(car.class)) {
    bad('car.ordinal and car.class required')
  }
  const carOrdinal = car.ordinal as number
  const carClass = car.class as number
  const carDisplayName = typeof car.displayName === 'string' ? car.displayName : null

  const sess = b.session
  if (!sess || !Number.isInteger(sess.piAtStart)) bad('session.piAtStart required')
  const startedAt = toDate(sess.startedAt, 'session.startedAt')
  const endedAt = sess.endedAt == null ? null : toDate(sess.endedAt, 'session.endedAt')

  const lap = b.lap
  if (!lap || !Number.isInteger(lap.lapNumber) || !Number.isInteger(lap.timeMs)) {
    bad('lap.lapNumber and lap.timeMs required')
  }
  if (typeof lap.framesB64 !== 'string' || !lap.framesB64) bad('lap.framesB64 required')
  const framesBlob = Buffer.from(lap.framesB64, 'base64')
  // sniff for a known frames blob (gzip 0x1f8b legacy, or "FZC1" columnar)
  const okBlob = (framesBlob[0] === 0x1f && framesBlob[1] === 0x8b)
    || (framesBlob[0] === 0x46 && framesBlob[1] === 0x5a && framesBlob[2] === 0x43 && framesBlob[3] === 0x31)
  if (!okBlob) bad('lap.framesB64 is not a recognized frames blob')

  return await db.transaction(async (tx) => {
    const created = { car: false, event: false, build: false, tune: false, session: false }

    // car — by (gameId, ordinal); per-game catalog
    let carRow = (await tx.select().from(schema.cars)
      .where(and(eq(schema.cars.gameId, gameId), eq(schema.cars.ordinal, carOrdinal))).limit(1))[0]
    if (!carRow) {
      carRow = (await tx.insert(schema.cars).values({ gameId, ordinal: carOrdinal, class: carClass, displayName: carDisplayName }).returning())[0]!
      created.car = true
    }

    // event — by (gameId, name); type is optional discipline metadata
    let eventRow = (await tx.select().from(schema.events)
      .where(and(eq(schema.events.gameId, gameId), eq(schema.events.name, eventName))).limit(1))[0]
    if (!eventRow) {
      eventRow = (await tx.insert(schema.events).values({ gameId, name: eventName, type: evType }).returning())[0]!
      created.event = true
    }

    // build — by (carId, name)
    let buildId: number | null = null
    if (b.build && typeof b.build.name === 'string' && b.build.name) {
      const name = b.build.name
      let buildRow = (await tx.select().from(schema.builds)
        .where(and(eq(schema.builds.carId, carRow.id), eq(schema.builds.name, name))).limit(1))[0]
      if (!buildRow) {
        buildRow = (await tx.insert(schema.builds)
          .values({ carId: carRow.id, name, settings: b.build.settings ?? {} }).returning())[0]!
        created.build = true
      }
      buildId = buildRow.id
    }

    // tune — by (buildId, name)
    let tuneId: number | null = null
    if (b.tune && typeof b.tune.name === 'string' && b.tune.name && buildId != null) {
      const name = b.tune.name
      let tuneRow = (await tx.select().from(schema.tunes)
        .where(and(eq(schema.tunes.buildId, buildId), eq(schema.tunes.name, name))).limit(1))[0]
      if (!tuneRow) {
        tuneRow = (await tx.insert(schema.tunes)
          .values({ buildId, name, settings: b.tune.settings ?? {} }).returning())[0]!
        created.tune = true
      }
      tuneId = tuneRow.id
    }

    // session — by (eventId, carId, startedAt)
    const sameEventCar = await tx.select().from(schema.sessions)
      .where(and(eq(schema.sessions.eventId, eventRow.id), eq(schema.sessions.carId, carRow.id)))
    let sessionRow = sameEventCar.find(s => s.startedAt.getTime() === startedAt.getTime())
    if (!sessionRow) {
      sessionRow = (await tx.insert(schema.sessions).values({
        gameId,
        eventId: eventRow.id,
        carId: carRow.id,
        tuneLabel: typeof sess.tuneLabel === 'string' ? sess.tuneLabel : null,
        piAtStart: sess.piAtStart as number,
        startedAt,
        endedAt,
        buildId,
        buildSnapshot: sess.buildSnapshot ?? null,
        tuneId,
        tuneSnapshot: sess.tuneSnapshot ?? null
      }).returning())[0]!
      created.session = true
    }

    // lap — by (sessionId, lapNumber); skip if already present
    const lapNumber = lap.lapNumber as number
    const existingLap = (await tx.select({ id: schema.laps.id }).from(schema.laps)
      .where(and(eq(schema.laps.sessionId, sessionRow.id), eq(schema.laps.lapNumber, lapNumber))).limit(1))[0]
    if (existingLap) {
      return {
        lapId: existingLap.id,
        sessionId: sessionRow.id,
        eventId: eventRow.id,
        eventType: eventRow.type,
        alreadyPresent: true,
        created
      }
    }

    const lapRow = (await tx.insert(schema.laps)
      .values({ sessionId: sessionRow.id, lapNumber, timeMs: lap.timeMs as number, framesBlob })
      .returning())[0]!

    return {
      lapId: lapRow.id,
      sessionId: sessionRow.id,
      eventId: eventRow.id,
      eventType: eventRow.type,
      alreadyPresent: false,
      created
    }
  })
})
