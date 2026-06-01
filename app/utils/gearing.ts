/**
 * Gearing measurement — Automation's "power vs traction" graph, built straight
 * from telemetry: per gear, the achieved longitudinal acceleration (g) and
 * engine power across vehicle speed.
 *
 * Both channels are MEASURED, not derived. At full throttle each frame is
 * binned by (gear, speed):
 *
 *   accel-g = Δspeed / Δt / g      (longitudinal, from the forward-speed channel
 *                                   so it's free of any accel-axis convention;
 *                                   the real traction ceiling + drag are baked in)
 *   power   = engine power (kW)
 *
 * Speed is the shared x-axis, one series per gear. Where a gear's curve drops
 * below the next gear's, the gears trade places; the gap between a gear's top
 * and the next curve is the acceleration (or power) you give up across that
 * ratio step — exactly what reveals over-long gearing.
 *
 * Using measured g (rather than torque·ratio/radius force) means no gear-ratio
 * or tire-radius derivation, no dependence on FH6's wheel-rotation channel, and
 * the traction limit comes for free — you can't measure more g than the tyres
 * delivered.
 *
 * Pure module — no Vue, no Nuxt — so it's trivially unit-testable, mirroring
 * dyno.ts.
 */

import type { Telemetry } from '../../server/utils/decode'

/** Forward gears in Forza's raw encoding: 0=R, 1..10=forward, 11=N (mid-shift). */
const FORWARD_MIN = 1
const FORWARD_MAX = 10
/** Throttle floor for a frame to count — full-throttle pull only. */
const WOT_THRESHOLD = 0.9
/** Speed bin width (km/h). */
const SPEED_BIN_KMH = 2
/** Standard gravity (m/s²). */
const G = 9.80665
/** Frame-gap bounds (s) for a trustworthy speed derivative — rejects paused /
 *  dropped frames and sub-millisecond noise. */
const MIN_DT_S = 0.005
const MAX_DT_S = 0.1
/** Sanity clamp on derived g — drops collision/curb spikes. */
const MAX_ABS_G = 4

interface SpeedBin {
  /** Sum / count of engine power (kW) at WOT in this bin. */
  pSum: number
  pCount: number
  /** Sum / count of longitudinal g at WOT in this bin. */
  gSum: number
  gCount: number
}

/** Streaming accumulator. Mutated in place by `ingestGearingFrame`. */
export interface GearingState {
  /** gear → (speed-bin centre → bin). */
  byGear: Map<number, Map<number, SpeedBin>>
  /** Previous frame's clock + speed, for the d(speed)/dt longitudinal g. */
  lastTimestampMs: number | null
  lastSpeedMps: number | null
}

export function emptyGearingState(): GearingState {
  return { byGear: new Map(), lastTimestampMs: null, lastSpeedMps: null }
}

/**
 * Ingest one frame. Mutates `state` in place. The speed derivative is tracked
 * from every frame (so it stays continuous), but power/g are only binned for
 * full-throttle frames in a forward gear.
 */
export function ingestGearingFrame(state: GearingState, f: Telemetry): void {
  const speedMps = f.speedKmh / 3.6

  // Longitudinal g from the change in forward speed since the last frame.
  let accelG: number | null = null
  if (state.lastTimestampMs !== null && state.lastSpeedMps !== null) {
    const dt = (f.timestampMs - state.lastTimestampMs) / 1000
    if (dt >= MIN_DT_S && dt <= MAX_DT_S) {
      const a = (speedMps - state.lastSpeedMps) / dt
      if (Math.abs(a) <= MAX_ABS_G * G) accelG = a / G
    }
  }
  state.lastTimestampMs = f.timestampMs
  state.lastSpeedMps = speedMps

  if (f.throttle < WOT_THRESHOLD) return
  if (f.gear < FORWARD_MIN || f.gear > FORWARD_MAX) return
  if (f.speedKmh <= 0) return

  const bucket = Math.round(f.speedKmh / SPEED_BIN_KMH) * SPEED_BIN_KMH
  let gearMap = state.byGear.get(f.gear)
  if (!gearMap) {
    gearMap = new Map()
    state.byGear.set(f.gear, gearMap)
  }
  let bin = gearMap.get(bucket)
  if (!bin) {
    bin = { pSum: 0, pCount: 0, gSum: 0, gCount: 0 }
    gearMap.set(bucket, bin)
  }
  bin.pSum += f.power / 1000
  bin.pCount += 1
  if (accelG !== null) {
    bin.gSum += accelG
    bin.gCount += 1
  }
}

// --- chart model (shared-speed grid, one series per gear) ------------------

export interface GearGridSeries {
  gear: number
  /** Mean longitudinal g at each grid speed; null where no full-throttle samples. */
  accelG: (number | null)[]
  /** Mean engine power (kW) at each grid speed; null where no samples. */
  power: (number | null)[]
}

export interface GearingGrid {
  /** Shared x-axis: vehicle speed (km/h), ascending. */
  speedsKmh: number[]
  series: GearGridSeries[]
  maxAccelG: number
  maxPowerKw: number
  /** Whether any accel / power samples landed — drives which Y lens is usable. */
  hasAccel: boolean
  hasPower: boolean
}

export function snapshotGearing(state: GearingState): GearingGrid {
  // Shared, sorted union of every speed bucket seen across all gears.
  const speedSet = new Set<number>()
  for (const gearMap of state.byGear.values()) {
    for (const s of gearMap.keys()) speedSet.add(s)
  }
  const speedsKmh = Array.from(speedSet).sort((a, b) => a - b)
  const idxOf = new Map<number, number>()
  speedsKmh.forEach((s, i) => idxOf.set(s, i))

  const gears = Array.from(state.byGear.keys()).sort((a, b) => a - b)
  let maxAccelG = 0
  let maxPowerKw = 0
  let hasAccel = false
  let hasPower = false

  const series: GearGridSeries[] = gears.map((gear) => {
    const accelG: (number | null)[] = new Array(speedsKmh.length).fill(null)
    const power: (number | null)[] = new Array(speedsKmh.length).fill(null)
    const gearMap = state.byGear.get(gear)!
    for (const [speed, bin] of gearMap) {
      const i = idxOf.get(speed)!
      if (bin.gCount > 0) {
        const g = bin.gSum / bin.gCount
        accelG[i] = g
        hasAccel = true
        if (g > maxAccelG) maxAccelG = g
      }
      if (bin.pCount > 0) {
        const p = bin.pSum / bin.pCount
        power[i] = p
        hasPower = true
        if (p > maxPowerKw) maxPowerKw = p
      }
    }
    return { gear, accelG, power }
  })

  return { speedsKmh, series, maxAccelG, maxPowerKw, hasAccel, hasPower }
}
