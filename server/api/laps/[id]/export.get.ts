import { eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import { decodeFrames } from '~~/server/utils/frames-codec'
import { toBundle, toCsv, type LapMeta } from '~~/server/utils/lap-export'
import { toLd } from '~~/server/utils/ld-export'

const FORMATS = ['csv', 'json', 'ld', 'bundle'] as const
type Format = typeof FORMATS[number]

const EXT: Record<Format, string> = {
  csv: 'csv',
  json: 'json',
  ld: 'ld',
  bundle: 'codriver.json'
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'lap'
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid lap id' })
  }

  const format = (getQuery(event).format ?? 'csv') as string
  if (!FORMATS.includes(format as Format)) {
    throw createError({ statusCode: 400, statusMessage: `format must be one of: ${FORMATS.join(', ')}` })
  }
  const fmt = format as Format

  const row = (await db
    .select({
      lap: schema.laps,
      gameId: schema.sessions.gameId,
      tuneLabel: schema.sessions.tuneLabel,
      piAtStart: schema.sessions.piAtStart,
      startedAt: schema.sessions.startedAt,
      endedAt: schema.sessions.endedAt,
      buildSnapshot: schema.sessions.buildSnapshot,
      tuneSnapshot: schema.sessions.tuneSnapshot,
      eventName: schema.events.name,
      eventType: schema.events.type,
      buildName: schema.builds.name,
      buildSettings: schema.builds.settings,
      tuneName: schema.tunes.name,
      tuneSettings: schema.tunes.settings,
      carOrdinal: schema.cars.ordinal,
      carClass: schema.cars.class,
      carDisplayName: schema.cars.displayName
    })
    .from(schema.laps)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.laps.sessionId))
    .innerJoin(schema.events, eq(schema.events.id, schema.sessions.eventId))
    .innerJoin(schema.cars, eq(schema.cars.id, schema.sessions.carId))
    .leftJoin(schema.builds, eq(schema.builds.id, schema.sessions.buildId))
    .leftJoin(schema.tunes, eq(schema.tunes.id, schema.sessions.tuneId))
    .where(eq(schema.laps.id, id))
    .limit(1))[0]

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'lap not found' })
  }

  const meta: LapMeta = {
    gameId: row.gameId,
    event: { name: row.eventName, type: row.eventType },
    car: { ordinal: row.carOrdinal, class: row.carClass, displayName: row.carDisplayName },
    build: row.buildName ? { name: row.buildName, settings: row.buildSettings } : null,
    tune: row.tuneName ? { name: row.tuneName, settings: row.tuneSettings } : null,
    session: {
      tuneLabel: row.tuneLabel,
      piAtStart: row.piAtStart,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      buildSnapshot: row.buildSnapshot,
      tuneSnapshot: row.tuneSnapshot
    },
    lap: { lapNumber: row.lap.lapNumber, timeMs: row.lap.timeMs }
  }

  const carLabel = safe(row.carDisplayName ?? `car${row.carOrdinal}`)
  const filename = `lap${row.lap.lapNumber}-${carLabel}-${safe(row.eventName)}.${EXT[fmt]}`
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)

  if (fmt === 'bundle') {
    setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
    return JSON.stringify(toBundle(meta, row.lap.framesBlob.toString('base64')), null, 2)
  }

  const frames = decodeFrames(row.lap.framesBlob)

  if (fmt === 'json') {
    setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
    return JSON.stringify({ ...meta, frames }, null, 2)
  }

  const t0 = frames[0]?.timestampMs ?? 0

  if (fmt === 'ld') {
    setHeader(event, 'Content-Type', 'application/octet-stream')
    return toLd(frames, t0, meta)
  }

  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  return toCsv(frames, t0)
})
