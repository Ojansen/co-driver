/**
 * Trail-braking detector.
 *
 * Trail-braking = continuing to brake while turning into a corner, with the
 * brake input progressively releasing as the steering ramps up. The technique
 * keeps weight on the front tires through entry and aids rotation, but
 * requires brake-bias tuning advice different from straight-line braking
 * (see /tune/brakes).
 *
 * We can't ask Forza whether the driver is trail-braking — but we can read
 * brake + steer + timestampMs from the existing telemetry stream and infer it:
 *   1. Brake input is still meaningfully engaged (not coasting).
 *   2. Steering input is meaningfully engaged (not straight-line braking).
 *   3. Brake was *higher* a moment ago — the technique's defining feature is
 *      progressive release during the turn, not steady-state pedal pressure.
 *
 * All three conditions held for ≥ ~100 ms (debounce) → trail-braking active.
 *
 * Pure module — no Vue/Nuxt — trivially unit-testable.
 */

import type { Telemetry } from '../../server/utils/decode'

export interface TrailBrakingOptions {
  /** Look-back window for the "brake was higher recently" check. Default 500 ms. */
  lookbackMs?: number
  /** Minimum current brake input (0..1). Default 0.10. */
  brakeMin?: number
  /** Minimum |steer| input (0..1). Default 0.15. */
  steerMin?: number
  /** Brake must have been at least this much higher at lookback time. Default 0.10. */
  brakeDecayDelta?: number
  /** Debounce: a band must be at least this many consecutive true frames to survive. Default 6 (~100 ms at 60 Hz). */
  minSustainFrames?: number
}

/** Minimum brake input (0..1) counted as "braking" — the TB% denominator and
 *  the detector's brake gate share this. Exported so consumers that count
 *  braking frames themselves stay aligned with the detector. */
export const TRAIL_BRAKE_MIN = 0.10

const DEFAULTS: Required<TrailBrakingOptions> = {
  lookbackMs: 500,
  brakeMin: TRAIL_BRAKE_MIN,
  steerMin: 0.15,
  brakeDecayDelta: 0.10,
  minSustainFrames: 6
}

type DetectorFrame = Pick<Telemetry, 'timestampMs' | 'brake' | 'steer'>

/**
 * Per-frame: is the driver trail-braking at frame i? Pre-debounce.
 *
 * Compares current brake to the MAX brake in the lookback window — that's
 * the right shape for "brake was higher recently," because the peak can sit
 * anywhere in the window. Comparing to a single point N ms ago misses the
 * peak when the brake ramped up *inside* the window.
 *
 * Window start advances monotonically with i; the inner max scan is bounded
 * by the window size (~30 frames at 60 Hz / 500 ms), so total work is O(n).
 */
function detectRaw(frames: DetectorFrame[], opts: Required<TrailBrakingOptions>): boolean[] {
  const out: boolean[] = new Array(frames.length).fill(false)
  let windowStart = 0
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!
    // Slide the window forward so frames[windowStart..i] is the lookback range.
    const cutoff = f.timestampMs - opts.lookbackMs
    while (windowStart < i && frames[windowStart]!.timestampMs < cutoff) windowStart++

    if (f.brake < opts.brakeMin) continue
    if (Math.abs(f.steer) < opts.steerMin) continue

    // Scan the window for max brake.
    let maxBrake = f.brake
    for (let k = windowStart; k < i; k++) {
      const b = frames[k]!.brake
      if (b > maxBrake) maxBrake = b
    }
    if (maxBrake - f.brake < opts.brakeDecayDelta) continue

    out[i] = true
  }
  return out
}

/**
 * Apply the minSustainFrames debounce: only keep runs that hold for at
 * least N consecutive frames; everything else flips to false.
 */
function debounce(flags: boolean[], minSustain: number): boolean[] {
  if (minSustain <= 1) return flags.slice()
  const out: boolean[] = new Array(flags.length).fill(false)
  let runStart = -1
  for (let i = 0; i <= flags.length; i++) {
    const v = i < flags.length ? flags[i] : false
    if (v && runStart < 0) runStart = i
    else if (!v && runStart >= 0) {
      const len = i - runStart
      if (len >= minSustain) {
        for (let k = runStart; k < i; k++) out[k] = true
      }
      runStart = -1
    }
  }
  return out
}

/** Per-frame trail-braking detection (with debounce applied). */
export function detectTrailBraking(
  frames: DetectorFrame[],
  opts?: TrailBrakingOptions
): boolean[] {
  const merged = { ...DEFAULTS, ...opts }
  const raw = detectRaw(frames, merged)
  return debounce(raw, merged.minSustainFrames)
}

/** Compact a per-frame boolean flag array into contiguous index ranges. */
export function trailBrakingBands(
  flags: boolean[]
): Array<{ startIdx: number, endIdx: number }> {
  const out: Array<{ startIdx: number, endIdx: number }> = []
  let runStart = -1
  for (let i = 0; i <= flags.length; i++) {
    const v = i < flags.length ? flags[i] : false
    if (v && runStart < 0) runStart = i
    else if (!v && runStart >= 0) {
      out.push({ startIdx: runStart, endIdx: i - 1 })
      runStart = -1
    }
  }
  return out
}

export interface TrailBrakingSummary {
  /** Frames where brake was above brakeMin. The denominator for `ratio`. */
  brakingFrames: number
  /** Frames where the (debounced) detector returned true. */
  trailBrakingFrames: number
  /** trailBrakingFrames / brakingFrames; 0 when brakingFrames === 0. */
  ratio: number
  /** Distinct trail-braking events (debounced contiguous runs). */
  events: number
}

export function summarizeTrailBraking(
  frames: DetectorFrame[],
  opts?: TrailBrakingOptions
): TrailBrakingSummary {
  const merged = { ...DEFAULTS, ...opts }
  const flags = detectTrailBraking(frames, merged)

  let brakingFrames = 0
  let trailBrakingFrames = 0
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]!.brake >= merged.brakeMin) brakingFrames++
    if (flags[i]) trailBrakingFrames++
  }
  const events = trailBrakingBands(flags).length
  const ratio = brakingFrames > 0 ? trailBrakingFrames / brakingFrames : 0
  return { brakingFrames, trailBrakingFrames, ratio, events }
}
