import { and, desc, eq } from 'drizzle-orm'
import { gunzipSync } from 'node:zlib'
import { db, schema } from 'hub:db'
import type { Telemetry } from '~~/server/utils/decode'
import { summarizeFrames, type FrameAggregates } from '~~/app/utils/tune-signals'
import { damperHistogramsForLap, damperScatterForLap, type DamperHistogram, type DamperScatterPoint } from '~~/app/utils/damper-velocity'
import { rideHeightHistogramsForLap, type RideHeightHistogram } from '~~/app/utils/ride-height'
import {
  rpmDistribution,
  slipAngleBalanceDistribution,
  tireTempDistributions,
  slipRatioDistributions,
  type QuadDistribution
} from '~~/app/utils/channel-distributions'
import type { BinnedValues } from '~~/app/utils/histogram-core'
import { binFrames, type DynoCurve } from '~~/app/utils/dyno'
import type { BuildSettings } from '~~/app/utils/build-fields'

/**
 * Telemetry-grounded "Your data" signals for the /tune/* reference pages.
 *
 * Resolution order:
 *   1. ?car=<ordinal>&build=<id> — explicit override.
 *   2. car only → use that car's most-recent session's build.
 *   3. no params → most-recent session on any car, use its build.
 *
 * Pulls the last N laps (capped at 20, default 5) for that (carId, buildId)
 * pair across all sessions, gunzips frames, runs summarizeFrames over the
 * concatenated lap frames, and returns the aggregates plus a touch of
 * car/build identity for the panel header.
 *
 * Empty state: lapCount === 0 means the panel has nothing to render.
 */

const DEFAULT_LAPS = 5
const MAX_LAPS = 20

export default defineEventHandler(async (event) => {
  const q = getQuery(event)

  const carOrdinalParam = q.car != null ? Number(q.car) : null
  const buildIdParam = q.build != null ? Number(q.build) : null
  const lapsParam = q.laps != null ? Number(q.laps) : DEFAULT_LAPS
  const lapLimit = Math.max(1, Math.min(MAX_LAPS, Number.isFinite(lapsParam) ? lapsParam : DEFAULT_LAPS))

  // --- resolve car + build -------------------------------------------------

  let carId: number | null = null
  let carOrdinal: number | null = null
  let carDisplayName: string | null = null
  let carClass: number | null = null
  let buildId: number | null = null
  let buildName: string | null = null

  // Explicit params that don't resolve → empty bundle. Don't silently fall
  // through to last-driven, since the user asked for a specific context.
  if (carOrdinalParam !== null && Number.isFinite(carOrdinalParam)) {
    const car = (await db
      .select({ id: schema.cars.id, ordinal: schema.cars.ordinal, displayName: schema.cars.displayName, class: schema.cars.class })
      .from(schema.cars)
      .where(eq(schema.cars.ordinal, carOrdinalParam))
      .limit(1))[0]
    if (!car) return emptyBundle(null, null, null, null, null, lapLimit)
    carId = car.id
    carOrdinal = car.ordinal
    carDisplayName = car.displayName
    carClass = car.class
  }

  if (buildIdParam !== null && Number.isFinite(buildIdParam)) {
    const b = (await db
      .select({ id: schema.builds.id, name: schema.builds.name, carId: schema.builds.carId })
      .from(schema.builds)
      .where(eq(schema.builds.id, buildIdParam))
      .limit(1))[0]
    if (!b) return emptyBundle(carOrdinal, carDisplayName, carClass, null, null, lapLimit)
    buildId = b.id
    buildName = b.name
    // Lock car to the build's car if not already set, or override if mismatched.
    if (carId === null || carId !== b.carId) {
      const car = (await db
        .select({ id: schema.cars.id, ordinal: schema.cars.ordinal, displayName: schema.cars.displayName, class: schema.cars.class })
        .from(schema.cars)
        .where(eq(schema.cars.id, b.carId))
        .limit(1))[0]
      if (car) {
        carId = car.id
        carOrdinal = car.ordinal
        carDisplayName = car.displayName
        carClass = car.class
      }
    }
  }

  // Fall back to the latest session if either is still unresolved.
  if (carId === null || buildId === null) {
    const latest = (await db
      .select({
        carId: schema.sessions.carId,
        buildId: schema.sessions.buildId,
        carOrdinal: schema.cars.ordinal,
        carDisplayName: schema.cars.displayName,
        carClass: schema.cars.class,
        buildName: schema.builds.name
      })
      .from(schema.sessions)
      .leftJoin(schema.cars, eq(schema.cars.id, schema.sessions.carId))
      .leftJoin(schema.builds, eq(schema.builds.id, schema.sessions.buildId))
      .where(carId !== null ? eq(schema.sessions.carId, carId) : undefined)
      .orderBy(desc(schema.sessions.startedAt))
      .limit(1))[0]
    if (latest) {
      if (carId === null) {
        carId = latest.carId
        carOrdinal = latest.carOrdinal
        carDisplayName = latest.carDisplayName
        carClass = latest.carClass
      }
      if (buildId === null && latest.buildId !== null) {
        buildId = latest.buildId
        buildName = latest.buildName
      }
    }
  }

  // No car at all in the database — return an empty bundle.
  if (carId === null) {
    return emptyBundle(carOrdinal, carDisplayName, carClass, buildId, buildName, lapLimit)
  }

  // --- pull the N most recent timed laps for this (car, build) -------------

  const lapRows = await db
    .select({
      id: schema.laps.id,
      timeMs: schema.laps.timeMs,
      framesBlob: schema.laps.framesBlob
    })
    .from(schema.laps)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.laps.sessionId))
    .where(
      buildId !== null
        ? and(eq(schema.sessions.carId, carId), eq(schema.sessions.buildId, buildId))
        : eq(schema.sessions.carId, carId)
    )
    .orderBy(desc(schema.laps.id))
    .limit(lapLimit)

  // Drivetrain comes from the build's current settings (the user is looking
  // at the live build on the page, not a session snapshot). Used by the
  // differential / center-diff binding to decide which wheels to read.
  let drivetrain: 'fwd' | 'rwd' | 'awd' | null = null
  if (buildId !== null) {
    const b = (await db
      .select({ settings: schema.builds.settings })
      .from(schema.builds)
      .where(eq(schema.builds.id, buildId))
      .limit(1))[0]
    drivetrain = readDrivetrain(b?.settings as BuildSettings | null | undefined)
  }

  const allFrames: Telemetry[] = []
  for (const lap of lapRows) {
    if (!lap.framesBlob) continue
    if (lap.timeMs <= 0) continue
    try {
      const decoded = JSON.parse(gunzipSync(lap.framesBlob).toString('utf8')) as Telemetry[]
      for (const f of decoded) allFrames.push(f)
    } catch (err) {
      console.error(`[tune-data] failed to read lap ${lap.id}:`, err)
    }
  }

  const lapCount = lapRows.filter(l => l.timeMs > 0 && l.framesBlob).length
  const signals = summarizeFrames(allFrames)
  // Per-corner damper velocity histograms over the same N-lap window the
  // signals are computed over. null when there aren't enough usable
  // frame transitions (e.g. an empty bundle).
  const damperHistograms = damperHistogramsForLap(allFrames)
  // Position-domain suspension companions to the damper histogram — same
  // N-lap window, computed server-side so raw frames stay on the server.
  const rideHeightHistograms = rideHeightHistogramsForLap(allFrames)
  const damperScatter = damperScatterForLap(allFrames)
  // Per-channel distributions for the gearing / balance / tire-temp pages, plus
  // the engine curve for /tune/gearing. All over the same N-lap window.
  const rpmHistogram = rpmDistribution(allFrames)
  const slipAngleBalance = slipAngleBalanceDistribution(allFrames)
  const tireTemp = tireTempDistributions(allFrames)
  const slipRatio = slipRatioDistributions(allFrames)
  const dynoCurve: DynoCurve | null = allFrames.length > 0 ? binFrames(allFrames) : null

  return {
    car: carOrdinal !== null
      ? { ordinal: carOrdinal, displayName: carDisplayName, class: carClass }
      : null,
    build: buildId !== null ? { id: buildId, name: buildName } : null,
    drivetrain,
    lapCount,
    frameCount: allFrames.length,
    signals,
    damperHistograms,
    rideHeightHistograms,
    damperScatter,
    rpmHistogram,
    slipAngleBalance,
    tireTemp,
    slipRatio,
    dynoCurve
  }
})

function readDrivetrain(snapshot: BuildSettings | null | undefined): 'fwd' | 'rwd' | 'awd' | null {
  if (!snapshot) return null
  const v = (snapshot as Record<string, unknown>).drivetrain
  if (v === 'fwd' || v === 'rwd' || v === 'awd') return v
  return null
}

function emptyBundle(
  carOrdinal: number | null,
  carDisplayName: string | null,
  carClass: number | null,
  buildId: number | null,
  buildName: string | null,
  _lapLimit: number
): {
  car: { ordinal: number, displayName: string | null, class: number | null } | null
  build: { id: number, name: string | null } | null
  drivetrain: null
  lapCount: 0
  frameCount: 0
  signals: FrameAggregates
  damperHistograms: { fl: DamperHistogram, fr: DamperHistogram, rl: DamperHistogram, rr: DamperHistogram } | null
  rideHeightHistograms: { fl: RideHeightHistogram, fr: RideHeightHistogram, rl: RideHeightHistogram, rr: RideHeightHistogram } | null
  damperScatter: { fl: DamperScatterPoint[], fr: DamperScatterPoint[], rl: DamperScatterPoint[], rr: DamperScatterPoint[] } | null
  rpmHistogram: BinnedValues | null
  slipAngleBalance: BinnedValues | null
  tireTemp: QuadDistribution | null
  slipRatio: QuadDistribution | null
  dynoCurve: DynoCurve | null
} {
  return {
    car: carOrdinal !== null
      ? { ordinal: carOrdinal, displayName: carDisplayName, class: carClass }
      : null,
    build: buildId !== null ? { id: buildId, name: buildName } : null,
    drivetrain: null,
    lapCount: 0,
    frameCount: 0,
    signals: summarizeFrames([]),
    damperHistograms: null,
    rideHeightHistograms: null,
    damperScatter: null,
    rpmHistogram: null,
    slipAngleBalance: null,
    tireTemp: null,
    slipRatio: null,
    dynoCurve: null
  }
}
