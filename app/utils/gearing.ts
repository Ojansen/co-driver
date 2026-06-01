/**
 * Gearing derivation — turns a torque/power dyno curve plus measured gear
 * ratios into an Automation-style tractive-effort chart (force/power at the
 * wheels vs vehicle speed, one curve per gear).
 *
 * Forza's Data Out packet does NOT expose gear ratios. We derive them live:
 *
 *   combined ratio  R = ω_engine / ω_wheel   (engine:wheel reduction, folds in
 *                                              gearbox × final drive)
 *   rolling radius  r = v_ground / ω_wheel    (effective tire radius)
 *
 * where ω_engine = rpm·π/30 (rad/s) and ω_wheel is the driven-wheel angular
 * velocity from the FH6 `wheelRotation` quad (rad/s). R is purely mechanical —
 * it holds even under wheelspin because engine and driven wheels are rigidly
 * coupled — so a handful of clean frames pins it exactly. The radius is read
 * from the *non-driven* wheels (which don't slip under power) so wheelspin
 * doesn't inflate it.
 *
 * From those two measured quantities and the dyno torque curve:
 *
 *   speed   v = ω_engine · r / R          (per gear)
 *   force   F = torque · R / r            (tractive effort at the contact patch)
 *   power   P = torque · ω_engine = engine power   (radius/ratio cancel — wheel
 *                                                   power equals engine power in
 *                                                   every gear; the dips in the
 *                                                   envelope ARE the upshift loss)
 *
 * Radius scales force by 1/r and speed by r uniformly across gears, so the
 * *shape* of the sawtooth — gear spacing, crossovers, where you fall off the
 * power — is independent of any radius error.
 *
 * Pure module — no Vue, no Nuxt — so it's trivially unit-testable, mirroring
 * dyno.ts which it consumes.
 */

import type { Quad, Telemetry } from '../../server/utils/decode'
import type { DynoCurve } from './dyno'

/** Forward gears in Forza's raw encoding: 0=R, 1..10=forward, 11=N (mid-shift). */
const FORWARD_MIN = 1
const FORWARD_MAX = 10
/** rpm → rad/s. */
const RPM_TO_RADS = Math.PI / 30
/** Minimum clean frames before a gear's ratio is trusted. R is deterministic,
 *  so this only needs to clear transient mid-shift noise. */
const MIN_RATIO_SAMPLES = 4
/** Clutch must be essentially released (engaged) — a slipping clutch breaks the
 *  rigid engine↔wheel coupling that makes R a constant. */
const CLUTCH_ENGAGED_MAX = 0.1
/** Driven-wheel angular speed floor (rad/s) — below this rpm/ω is numerically noisy. */
const MIN_WHEEL_RADS = 3
/** Slip ceiling for radius samples (non-driven wheels barely slip; keep it tight). */
const RADIUS_SLIP_MAX = 0.05
/** Ground-speed floor (km/h) for radius samples. */
const RADIUS_MIN_KMH = 15
/** Plausibility bounds — drop garbage from partial shifts / decode hiccups. */
const RATIO_MIN = 1
const RATIO_MAX = 60
const RADIUS_MIN_M = 0.2
const RADIUS_MAX_M = 0.6

export interface GearEstimate {
  /** Forward gear number (1..10). */
  gear: number
  /** Combined engine:wheel reduction (gearbox × final drive). */
  ratio: number
  /** Clean frames that fed this estimate. */
  samples: number
}

export interface GearingModel {
  /** Forward gears with a trusted ratio, ascending. */
  gears: GearEstimate[]
  /** Effective rolling radius (m), or null until enough clean frames seen. */
  tireRadiusM: number | null
  /** Driven-wheel layout the ratios were measured on (0=FWD, 1=RWD, 2=AWD). */
  drivetrain: number | null
}

/** Streaming accumulator. Mutated in place by `ingestGearingFrame`. */
export interface GearingState {
  byGear: Map<number, { ratioSum: number, count: number }>
  radiusSum: number
  radiusCount: number
  drivetrain: number | null
}

export function emptyGearingState(): GearingState {
  return { byGear: new Map(), radiusSum: 0, radiusCount: 0, drivetrain: null }
}

/** Mean |rotation| of the requested wheels (rad/s). */
function avgRot(rot: Quad, wheels: (keyof Quad)[]): number {
  let sum = 0
  for (const w of wheels) sum += Math.abs(rot[w])
  return sum / wheels.length
}

function avgSlip(slip: Quad, wheels: (keyof Quad)[]): number {
  let sum = 0
  for (const w of wheels) sum += Math.abs(slip[w])
  return sum / wheels.length
}

/** Wheels coupled to the engine, by drivetrain (0=FWD, 1=RWD, 2=AWD). */
function drivenWheels(drivetrain: number): (keyof Quad)[] {
  if (drivetrain === 0) return ['fl', 'fr']
  if (drivetrain === 1) return ['rl', 'rr']
  return ['fl', 'fr', 'rl', 'rr']
}

/** Wheels used for the rolling-radius read — the non-driven axle when there is
 *  one (it doesn't slip under power), else all four for AWD. */
function radiusWheels(drivetrain: number): (keyof Quad)[] {
  if (drivetrain === 0) return ['rl', 'rr']
  if (drivetrain === 1) return ['fl', 'fr']
  return ['fl', 'fr', 'rl', 'rr']
}

/**
 * Ingest one frame into the streaming state. Mutates `state` in place. Needs
 * the FH6 `wheelRotation` channel — frames without it (other feeds) are no-ops.
 */
export function ingestGearingFrame(state: GearingState, f: Telemetry): void {
  const rot = f.wheelRotation
  if (!rot) return
  if (f.gear < FORWARD_MIN || f.gear > FORWARD_MAX) return
  if (f.clutch > CLUTCH_ENGAGED_MAX) return
  if (f.rpm <= 0) return

  const dt = f.car.drivetrain
  state.drivetrain = dt

  // --- ratio: ω_engine / ω_driven-wheel (mechanical, slip-independent) ---
  const wDriven = avgRot(rot, drivenWheels(dt))
  if (wDriven >= MIN_WHEEL_RADS) {
    const ratio = (f.rpm * RPM_TO_RADS) / wDriven
    if (ratio >= RATIO_MIN && ratio <= RATIO_MAX) {
      const b = state.byGear.get(f.gear) ?? { ratioSum: 0, count: 0 }
      b.ratioSum += ratio
      b.count++
      state.byGear.set(f.gear, b)
    }
  }

  // --- rolling radius: v_ground / ω_non-driven-wheel (low-slip only) ---
  if (f.speedKmh >= RADIUS_MIN_KMH) {
    const refWheels = radiusWheels(dt)
    if (avgSlip(f.slipRatio, refWheels) < RADIUS_SLIP_MAX) {
      const wRef = avgRot(rot, refWheels)
      if (wRef >= MIN_WHEEL_RADS) {
        const r = (f.speedKmh / 3.6) / wRef
        if (r >= RADIUS_MIN_M && r <= RADIUS_MAX_M) {
          state.radiusSum += r
          state.radiusCount++
        }
      }
    }
  }
}

export function snapshotGearing(state: GearingState): GearingModel {
  const gears: GearEstimate[] = []
  for (const [gear, b] of state.byGear) {
    if (b.count < MIN_RATIO_SAMPLES) continue
    gears.push({ gear, ratio: b.ratioSum / b.count, samples: b.count })
  }
  gears.sort((a, b) => a.gear - b.gear)
  return {
    gears,
    tireRadiusM: state.radiusCount > 0 ? state.radiusSum / state.radiusCount : null,
    drivetrain: state.drivetrain
  }
}

// --- chart model ----------------------------------------------------------

export interface GearTracePoint {
  rpm: number
  speedKmh: number
  /** Tractive force at the contact patch (N). */
  forceN: number
  /** Wheel power (kW) — equals engine power. */
  powerKw: number
}

export interface GearTrace {
  gear: number
  ratio: number
  /** Points ascending by speed (= ascending by rpm). */
  points: GearTracePoint[]
}

export interface ShiftPoint {
  /** Upshift out of this gear into the next. */
  fromGear: number
  toGear: number
  /** Speed where the two gears make equal force — the optimal upshift point. */
  speedKmh: number
  /** Engine rpm in `fromGear` at that speed. */
  rpm: number
}

export interface GearingChart {
  traces: GearTrace[]
  shifts: ShiftPoint[]
  maxSpeedKmh: number
  maxForceN: number
  maxPowerKw: number
  /** False when torque is unavailable — force mode can't be drawn, only power. */
  hasForce: boolean
}

/** Linear-interpolated force at a given speed within a trace, or null if out of range. */
function forceAtSpeed(trace: GearTrace, speedKmh: number): number | null {
  const pts = trace.points
  if (pts.length === 0) return null
  if (speedKmh < pts[0]!.speedKmh || speedKmh > pts[pts.length - 1]!.speedKmh) return null
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    if (speedKmh <= b.speedKmh) {
      const span = b.speedKmh - a.speedKmh
      const t = span > 0 ? (speedKmh - a.speedKmh) / span : 0
      return a.forceN + t * (b.forceN - a.forceN)
    }
  }
  return pts[pts.length - 1]!.forceN
}

/**
 * Optimal upshift speed for an adjacent gear pair: the speed where the shorter
 * gear's force drops to meet the taller gear's. Below it the short gear pulls
 * harder; above it you're better off already shifted. Returns null if the gears
 * never make equal force inside their shared speed window.
 */
function findCrossover(lower: GearTrace, upper: GearTrace): ShiftPoint | null {
  const loStart = Math.max(lower.points[0]!.speedKmh, upper.points[0]!.speedKmh)
  const loEnd = Math.min(
    lower.points[lower.points.length - 1]!.speedKmh,
    upper.points[upper.points.length - 1]!.speedKmh
  )
  if (loEnd <= loStart) return null
  // Walk the lower gear's sample points across the shared window; the crossover
  // is where (lower − upper) changes from positive to non-positive.
  let prevSpeed: number | null = null
  let prevDiff = 0
  for (const p of lower.points) {
    if (p.speedKmh < loStart || p.speedKmh > loEnd) continue
    const upperForce = forceAtSpeed(upper, p.speedKmh)
    if (upperForce === null) continue
    const diff = p.forceN - upperForce
    if (prevSpeed !== null && prevDiff > 0 && diff <= 0) {
      const span = diff - prevDiff
      const t = span !== 0 ? prevDiff / (prevDiff - diff) : 0
      const speedKmh = prevSpeed + t * (p.speedKmh - prevSpeed)
      // rpm in the lower gear at that speed: rpm = v(m/s)·R / r, and r = v/ω so
      // rpm = ω·R / (π/30); but simplest is to interpolate rpm along the trace.
      const rpm = interpRpmAtSpeed(lower, speedKmh)
      return { fromGear: lower.gear, toGear: upper.gear, speedKmh, rpm }
    }
    prevSpeed = p.speedKmh
    prevDiff = diff
  }
  return null
}

function interpRpmAtSpeed(trace: GearTrace, speedKmh: number): number {
  const pts = trace.points
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    if (speedKmh <= b.speedKmh) {
      const span = b.speedKmh - a.speedKmh
      const t = span > 0 ? (speedKmh - a.speedKmh) / span : 0
      return a.rpm + t * (b.rpm - a.rpm)
    }
  }
  return pts[pts.length - 1]?.rpm ?? 0
}

/**
 * Combine a dyno curve with measured gear ratios into the renderable chart
 * model. `model.tireRadiusM` sets the absolute axes; if it's null we fall back
 * to a nominal 0.32 m (only the axis labels shift — the sawtooth shape is
 * radius-invariant).
 */
export function buildGearingChart(dyno: DynoCurve, model: GearingModel): GearingChart {
  const radius = model.tireRadiusM ?? 0.32
  const hasForce = dyno.peakTorque !== null
  const traces: GearTrace[] = []
  let maxSpeedKmh = 0
  let maxForceN = 0
  let maxPowerKw = 0

  for (const g of model.gears) {
    const points: GearTracePoint[] = []
    for (const b of dyno.buckets) {
      const wEngine = b.rpm * RPM_TO_RADS
      const wWheel = wEngine / g.ratio
      const speedKmh = wWheel * radius * 3.6
      const forceN = (b.maxTorqueNm * g.ratio) / radius
      const powerKw = b.maxPowerKw
      points.push({ rpm: b.rpm, speedKmh, forceN, powerKw })
      if (speedKmh > maxSpeedKmh) maxSpeedKmh = speedKmh
      if (forceN > maxForceN) maxForceN = forceN
      if (powerKw > maxPowerKw) maxPowerKw = powerKw
    }
    if (points.length > 0) traces.push({ gear: g.gear, ratio: g.ratio, points })
  }

  const shifts: ShiftPoint[] = []
  for (let i = 1; i < traces.length; i++) {
    const cross = findCrossover(traces[i - 1]!, traces[i]!)
    if (cross) shifts.push(cross)
  }

  return { traces, shifts, maxSpeedKmh, maxForceN, maxPowerKw, hasForce }
}
