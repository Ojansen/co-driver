/**
 * Tune-page measurement aggregates.
 *
 * Each summarize* walks a flat Telemetry[] (typically the concatenation of
 * the user's last N laps for a given car/build) and returns a small object
 * the /tune/[slug] "Your data" panel can render. Pure module, neutral
 * vocabulary — measurements only, no judgment.
 *
 * Each helper handles empty input by returning the natural zero/null. The
 * caller decides what to render when there's no data.
 */

import type { Telemetry } from '../../server/utils/decode'

// --- shared helpers --------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (let i = 0; i < xs.length; i++) s += xs[i]!
  return s / xs.length
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[idx]!
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i]! - m
    s += d * d
  }
  return Math.sqrt(s / (xs.length - 1))
}

// --- suspension travel -----------------------------------------------------

export interface SuspensionTravelSummary {
  /** Average travel 0..1 across the front axle. */
  frontAvg: number
  /** 95th percentile of front travel. */
  frontP95: number
  rearAvg: number
  rearP95: number
  /** % frames where any wheel exceeds 0.95 compressed. */
  bottomingPct: number
  /** Stdev of frame-to-frame travel delta (oscillation proxy), averaged across axles. */
  oscillation: number
}

export function summarizeSuspensionTravel(frames: Telemetry[]): SuspensionTravelSummary {
  if (frames.length === 0) {
    return { frontAvg: 0, frontP95: 0, rearAvg: 0, rearP95: 0, bottomingPct: 0, oscillation: 0 }
  }
  const front: number[] = []
  const rear: number[] = []
  const frontDeltas: number[] = []
  const rearDeltas: number[] = []
  let bottoming = 0
  let prevFront = (frames[0]!.suspension.fl + frames[0]!.suspension.fr) / 2
  let prevRear = (frames[0]!.suspension.rl + frames[0]!.suspension.rr) / 2
  for (const f of frames) {
    const fAvg = (f.suspension.fl + f.suspension.fr) / 2
    const rAvg = (f.suspension.rl + f.suspension.rr) / 2
    front.push(fAvg)
    rear.push(rAvg)
    frontDeltas.push(fAvg - prevFront)
    rearDeltas.push(rAvg - prevRear)
    prevFront = fAvg
    prevRear = rAvg
    if (f.suspension.fl > 0.95 || f.suspension.fr > 0.95
      || f.suspension.rl > 0.95 || f.suspension.rr > 0.95) bottoming++
  }
  return {
    frontAvg: mean(front),
    frontP95: percentile(front, 0.95),
    rearAvg: mean(rear),
    rearP95: percentile(rear, 0.95),
    bottomingPct: bottoming / frames.length,
    oscillation: (stdev(frontDeltas) + stdev(rearDeltas)) / 2
  }
}

// --- slip angle (lateral) --------------------------------------------------

export interface SlipAngleSummary {
  /** Average |slip angle| in radians, averaged over the front axle. */
  frontAvg: number
  rearAvg: number
}

export function summarizeSlipAngle(frames: Telemetry[]): SlipAngleSummary {
  if (frames.length === 0) return { frontAvg: 0, rearAvg: 0 }
  let frontSum = 0
  let rearSum = 0
  for (const f of frames) {
    frontSum += (Math.abs(f.slipAngle.fl) + Math.abs(f.slipAngle.fr)) / 2
    rearSum += (Math.abs(f.slipAngle.rl) + Math.abs(f.slipAngle.rr)) / 2
  }
  return { frontAvg: frontSum / frames.length, rearAvg: rearSum / frames.length }
}

// --- slip ratio (longitudinal) under throttle ------------------------------

export interface SlipRatioSummary {
  /** Average |slip ratio| on each wheel while throttle > 0.5. */
  fl: number
  fr: number
  rl: number
  rr: number
  /** Frame count that passed the throttle gate (denominator). */
  throttleFrames: number
}

export function summarizeSlipRatioUnderThrottle(frames: Telemetry[]): SlipRatioSummary {
  let n = 0
  let fl = 0, fr = 0, rl = 0, rr = 0
  for (const f of frames) {
    if (f.throttle < 0.5) continue
    n++
    fl += Math.abs(f.slipRatio.fl)
    fr += Math.abs(f.slipRatio.fr)
    rl += Math.abs(f.slipRatio.rl)
    rr += Math.abs(f.slipRatio.rr)
  }
  if (n === 0) return { fl: 0, fr: 0, rl: 0, rr: 0, throttleFrames: 0 }
  return { fl: fl / n, fr: fr / n, rl: rl / n, rr: rr / n, throttleFrames: n }
}

// --- tire temp -------------------------------------------------------------

export interface TireTempSummary {
  fl: number
  fr: number
  rl: number
  rr: number
  /** % frames where ALL four tires sit in the 85..100 °C band. */
  allOptimalPct: number
}

const OPTIMAL_LO = 85
const OPTIMAL_HI = 100

export function summarizeTireTemp(frames: Telemetry[]): TireTempSummary {
  if (frames.length === 0) return { fl: 0, fr: 0, rl: 0, rr: 0, allOptimalPct: 0 }
  let fl = 0, fr = 0, rl = 0, rr = 0, optimal = 0
  for (const f of frames) {
    fl += f.tireTempC.fl
    fr += f.tireTempC.fr
    rl += f.tireTempC.rl
    rr += f.tireTempC.rr
    const inBand = (t: number): boolean => t >= OPTIMAL_LO && t <= OPTIMAL_HI
    if (inBand(f.tireTempC.fl) && inBand(f.tireTempC.fr)
      && inBand(f.tireTempC.rl) && inBand(f.tireTempC.rr)) optimal++
  }
  return {
    fl: fl / frames.length,
    fr: fr / frames.length,
    rl: rl / frames.length,
    rr: rr / frames.length,
    allOptimalPct: optimal / frames.length
  }
}

// --- brake shape -----------------------------------------------------------

export interface BrakeShapeSummary {
  /** Peak brake input seen across all frames (0..1). */
  peakPressure: number
  /** Mean brake input over the first 200 ms of each braking event. */
  avgEntryPressure: number
  /** Number of distinct braking events (brake > 0.1 onset). */
  brakingEvents: number
}

const BRAKE_ENGAGED = 0.1
const BRAKE_ENTRY_WINDOW_MS = 200

export function summarizeBrakeShape(frames: Telemetry[]): BrakeShapeSummary {
  if (frames.length === 0) return { peakPressure: 0, avgEntryPressure: 0, brakingEvents: 0 }
  let peak = 0
  let entrySum = 0
  let entryCount = 0
  let events = 0
  let inEvent = false
  let eventStartTs = 0
  for (const f of frames) {
    if (f.brake > peak) peak = f.brake
    if (!inEvent && f.brake >= BRAKE_ENGAGED) {
      inEvent = true
      eventStartTs = f.timestampMs
      events++
    } else if (inEvent && f.brake < BRAKE_ENGAGED) {
      inEvent = false
    }
    if (inEvent && f.timestampMs - eventStartTs <= BRAKE_ENTRY_WINDOW_MS) {
      entrySum += f.brake
      entryCount++
    }
  }
  return {
    peakPressure: peak,
    avgEntryPressure: entryCount > 0 ? entrySum / entryCount : 0,
    brakingEvents: events
  }
}

// --- aero / speed ----------------------------------------------------------

export interface AeroSummary {
  /** Top speed observed (km/h). */
  topSpeedKmh: number
  /** 95th-percentile |lateral G| while speed > 150 km/h. */
  lateralGP95HighSpeed: number
  /** Frame count above 150 km/h (denominator for the above). */
  highSpeedFrames: number
}

const HIGH_SPEED_KMH = 150

export function summarizeAero(frames: Telemetry[]): AeroSummary {
  if (frames.length === 0) return { topSpeedKmh: 0, lateralGP95HighSpeed: 0, highSpeedFrames: 0 }
  let top = 0
  const highSpeedLatG: number[] = []
  for (const f of frames) {
    if (f.speedKmh > top) top = f.speedKmh
    if (f.speedKmh >= HIGH_SPEED_KMH) {
      highSpeedLatG.push(Math.abs(f.acceleration.z))
    }
  }
  return {
    topSpeedKmh: top,
    lateralGP95HighSpeed: highSpeedLatG.length > 0 ? percentile(highSpeedLatG, 0.95) : 0,
    highSpeedFrames: highSpeedLatG.length
  }
}

// --- gear / rpm ------------------------------------------------------------

export interface GearSummary {
  /** Average RPM per gear seen in this sample (gear → avg rpm). */
  rpmByGear: Record<number, number>
  /** % frames at >= 98% of rpmMax. */
  atRevLimitPct: number
  /** Number of gear transitions (up or down). */
  shiftCount: number
}

const REV_LIMIT_FRACTION = 0.98

export function summarizeGearing(frames: Telemetry[]): GearSummary {
  if (frames.length === 0) return { rpmByGear: {}, atRevLimitPct: 0, shiftCount: 0 }
  const sumByGear = new Map<number, { sum: number, count: number }>()
  let nearLimit = 0
  let shifts = 0
  // Compare against the last *real* gear (1-10), not the immediately previous
  // frame. FH6 sends 11 (N) mid-shift, so a 3→4 upshift looks like 3→11→4 in
  // the stream — naively comparing adjacent frames would count it twice.
  let prevRealGear = 0
  const firstGear = frames[0]!.gear
  if (firstGear >= 1 && firstGear <= 10) prevRealGear = firstGear
  for (const f of frames) {
    if (f.gear < 11) {
      const bucket = sumByGear.get(f.gear) ?? { sum: 0, count: 0 }
      bucket.sum += f.rpm
      bucket.count++
      sumByGear.set(f.gear, bucket)
    }
    if (f.rpmMax > 0 && f.rpm >= f.rpmMax * REV_LIMIT_FRACTION) nearLimit++
    if (f.gear >= 1 && f.gear <= 10) {
      if (prevRealGear > 0 && f.gear !== prevRealGear) shifts++
      prevRealGear = f.gear
    }
  }
  const rpmByGear: Record<number, number> = {}
  for (const [gear, b] of sumByGear) {
    rpmByGear[gear] = b.sum / b.count
  }
  return { rpmByGear, atRevLimitPct: nearLimit / frames.length, shiftCount: shifts }
}

// --- engine power & torque -------------------------------------------------

export interface PowerSummary {
  /** Max power (kW) observed across all frames. */
  peakPowerKw: number
  /** Max torque (Nm) observed across all frames. */
  peakTorqueNm: number
  /** RPM at the frame that produced peak power. */
  rpmAtPeakPower: number
}

export function summarizePower(frames: Telemetry[]): PowerSummary {
  let peakPowerKw = 0
  let peakTorqueNm = 0
  let rpmAtPeakPower = 0
  for (const f of frames) {
    const pwKw = f.power / 1000
    if (pwKw > peakPowerKw) {
      peakPowerKw = pwKw
      rpmAtPeakPower = f.rpm
    }
    if ((f.torque ?? 0) > peakTorqueNm) peakTorqueNm = f.torque ?? 0
  }
  return { peakPowerKw, peakTorqueNm, rpmAtPeakPower }
}

// --- boost (turbo / supercharger) ------------------------------------------

export interface BoostSummary {
  /** Max boost observed across all frames (Forza units — typically PSI). */
  peakBoost: number
  /** Mean boost while throttle > 0.5. Naturally-aspirated cars stay near 0. */
  avgUnderThrottle: number
}

export function summarizeBoost(frames: Telemetry[]): BoostSummary {
  let peak = 0
  let sum = 0
  let n = 0
  for (const f of frames) {
    const boost = f.boost ?? 0
    if (boost > peak) peak = boost
    if (f.throttle > 0.5) {
      sum += boost
      n++
    }
  }
  return { peakBoost: peak, avgUnderThrottle: n > 0 ? sum / n : 0 }
}

// --- lateral G (general) ---------------------------------------------------

export interface LateralGSummary {
  /** Mean |lateral G|. */
  avg: number
  /** 95th-percentile |lateral G|. */
  p95: number
}

export function summarizeLateralG(frames: Telemetry[]): LateralGSummary {
  if (frames.length === 0) return { avg: 0, p95: 0 }
  const lat: number[] = frames.map(f => Math.abs(f.acceleration.z))
  return { avg: mean(lat), p95: percentile(lat, 0.95) }
}

// --- rumble strip contact --------------------------------------------------

export function rumbleContactPct(frames: Telemetry[]): number {
  if (frames.length === 0) return 0
  let n = 0
  for (const f of frames) {
    if (f.rumble?.fl || f.rumble?.fr || f.rumble?.rl || f.rumble?.rr) n++
  }
  return n / frames.length
}

// --- master roll-up (everything in one walk) -------------------------------

export interface FrameAggregates {
  suspensionTravel: SuspensionTravelSummary
  slipAngle: SlipAngleSummary
  slipRatio: SlipRatioSummary
  tireTempC: TireTempSummary
  brake: BrakeShapeSummary
  aero: AeroSummary
  gear: GearSummary
  lateralG: LateralGSummary
  power: PowerSummary
  boost: BoostSummary
  rumbleContactPct: number
}

export function summarizeFrames(frames: Telemetry[]): FrameAggregates {
  return {
    suspensionTravel: summarizeSuspensionTravel(frames),
    slipAngle: summarizeSlipAngle(frames),
    slipRatio: summarizeSlipRatioUnderThrottle(frames),
    tireTempC: summarizeTireTemp(frames),
    brake: summarizeBrakeShape(frames),
    aero: summarizeAero(frames),
    gear: summarizeGearing(frames),
    lateralG: summarizeLateralG(frames),
    power: summarizePower(frames),
    boost: summarizeBoost(frames),
    rumbleContactPct: rumbleContactPct(frames)
  }
}
