/**
 * Damper velocity histogram — the pro-tool standard view for suspension
 * tuning. Aggregates frame-to-frame `suspensionMeters` deltas into mm/s
 * velocity samples, then buckets them into a histogram that the
 * SuspensionHistogram component renders per corner.
 *
 * Reading the shape:
 *   - Ideal: symmetrical cone peaking near 12 % at 0 mm/s
 *   - Wide:  damper too soft, suspension moves quickly
 *   - Narrow: damper too stiff
 *   - Asymmetric: unbalanced bump vs rebound damping
 *
 * Compression is positive, rebound negative — same convention as the
 * real-time per-corner readout on CornerPanel.
 *
 * Pure module, trivially testable. Caller pre-filters frames to a single
 * lap (or N laps) before calling — this module doesn't know about lap
 * boundaries.
 */

import type { Telemetry } from '../../server/utils/decode'
import { binValues } from './histogram-core'

export type Corner = 'fl' | 'fr' | 'rl' | 'rr'

export interface DamperHistogram {
  /** N+1 mm/s edges defining N bins, left-inclusive / right-exclusive
   *  except the last bin which is right-inclusive. */
  binEdges: number[]
  /** Sample count per bin, length N. */
  counts: number[]
  /** Total samples (sum of counts). */
  totalSamples: number
  /** Index of the bin with the highest count. Centered cone ≈ ideal. */
  peakBinIndex: number
  /** counts[peakBinIndex] / totalSamples — 0..1. Pro target ≈ 0.12. */
  peakPct: number
  /** Time-share in each pro-tool zone. Sum is 1.0 (within rounding). */
  fastBumpPct: number // > +50 mm/s
  slowBumpPct: number // 0 .. +50 mm/s
  slowReboundPct: number // -50 .. 0 mm/s
  fastReboundPct: number // < -50 mm/s
}

/** Standard zones: finer near zero where most samples live, coarser at
 *  the tails where pros only care about "are there any spikes here." */
export const DEFAULT_BIN_EDGES: readonly number[] = [
  -250, -200, -150, -100, -75, -50, -25, 0,
  25, 50, 75, 100, 150, 200, 250
]

/** Maximum dt between frames (seconds) before we treat the transition as
 *  a pause or seek edge and drop the sample. Forza runs at 60 Hz → real
 *  dt ≈ 0.0167 s; anything past 0.1 s is almost certainly a gap. */
const MAX_DT_SEC = 0.1

/**
 * Compute per-frame damper velocity (mm/s, signed) for a corner from a
 * frame array. Output length = frames.length − 1, minus any samples
 * dropped at pause edges (no padding — caller can assume samples are
 * representative of in-motion driving).
 */
export function damperVelocityFromFrames(
  frames: Telemetry[],
  corner: Corner
): number[] {
  const out: number[] = []
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1]!
    const cur = frames[i]!
    const dtSec = (cur.timestampMs - prev.timestampMs) / 1000
    if (!Number.isFinite(dtSec) || dtSec <= 0 || dtSec > MAX_DT_SEC) continue
    const deltaM = cur.suspensionMeters[corner] - prev.suspensionMeters[corner]
    if (!Number.isFinite(deltaM)) continue
    out.push((deltaM / dtSec) * 1000)
  }
  return out
}

/**
 * Bucket velocity samples into a histogram. Returns null if `velocities`
 * is empty or `binEdges` has fewer than 2 entries.
 *
 * Bin assignment uses [edge[i], edge[i+1]) — left-inclusive, right-
 * exclusive — except the last bin which is [edge[N-1], edge[N]]
 * (both inclusive) so the maximum value lands in the last bin rather
 * than being dropped.
 *
 * Values outside [min, max] are clamped into the first / last bins
 * rather than dropped; preserves "you spent time past 250 mm/s" rather
 * than silently hiding extreme samples.
 */
export function computeHistogram(
  velocities: number[],
  binEdges: readonly number[] = DEFAULT_BIN_EDGES
): DamperHistogram | null {
  const binned = binValues(velocities, binEdges)
  if (!binned) return null

  // Zone time-shares — independent of bin edges; computed directly from
  // velocity samples so the percentages are exact even if bin edges
  // don't perfectly match the ±50 mm/s zone boundary.
  let fastBump = 0
  let slowBump = 0
  let slowReb = 0
  let fastReb = 0
  for (const v of velocities) {
    if (!Number.isFinite(v)) continue
    if (v > 50) fastBump++
    else if (v >= 0) slowBump++
    else if (v >= -50) slowReb++
    else fastReb++
  }
  const tot = velocities.length
  const fastBumpPct = tot > 0 ? fastBump / tot : 0
  const slowBumpPct = tot > 0 ? slowBump / tot : 0
  const slowReboundPct = tot > 0 ? slowReb / tot : 0
  const fastReboundPct = tot > 0 ? fastReb / tot : 0

  return {
    binEdges: binned.binEdges,
    counts: binned.counts,
    totalSamples: binned.totalSamples,
    peakBinIndex: binned.peakBinIndex,
    peakPct: binned.peakPct,
    fastBumpPct,
    slowBumpPct,
    slowReboundPct,
    fastReboundPct
  }
}

/**
 * Compute all four corner histograms from one set of frames. Convenience
 * for ReplayPlayer / compare.vue / tune-dampers panels that just want the
 * per-lap aggregate.
 *
 * Returns null if any corner produces no usable samples (lap was too
 * short or all dts exceeded the pause guard).
 */
export function damperHistogramsForLap(
  frames: Telemetry[],
  binEdges: readonly number[] = DEFAULT_BIN_EDGES
): { fl: DamperHistogram, fr: DamperHistogram, rl: DamperHistogram, rr: DamperHistogram } | null {
  const fl = computeHistogram(damperVelocityFromFrames(frames, 'fl'), binEdges)
  const fr = computeHistogram(damperVelocityFromFrames(frames, 'fr'), binEdges)
  const rl = computeHistogram(damperVelocityFromFrames(frames, 'rl'), binEdges)
  const rr = computeHistogram(damperVelocityFromFrames(frames, 'rr'), binEdges)
  if (!fl || !fr || !rl || !rr) return null
  return { fl, fr, rl, rr }
}

/** One point of the damper position×velocity scatter: normalized suspension
 *  travel (0 = full droop, 1 = bottomed) paired with the damper velocity at
 *  that frame. */
export interface DamperScatterPoint {
  /** Normalized suspension travel 0..1 at the current frame. */
  pos: number
  /** Damper velocity mm/s (signed: + compression, − rebound). */
  vel: number
}

/** Cap on points returned per corner. A whole lap at 60 Hz is ~5-7k samples;
 *  rendering that many SVG dots ×4 corners is wasteful and the shape reads
 *  the same after striding down to ~1k. */
export const DEFAULT_SCATTER_CAP = 1000

/**
 * Build the position×velocity scatter for one corner. Velocity reuses the
 * exact frame-to-frame calc (and pause-edge guard) as the histogram; each
 * sample is paired with the *current* frame's normalized travel (`suspension`,
 * not `suspensionMeters`, so the X axis is bounded 0..1 across every car).
 *
 * Strides the result down to at most `cap` points, evenly spaced, so density
 * stays representative rather than front-loaded.
 */
export function damperScatterFromFrames(
  frames: Telemetry[],
  corner: Corner,
  cap: number = DEFAULT_SCATTER_CAP
): DamperScatterPoint[] {
  const all: DamperScatterPoint[] = []
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1]!
    const cur = frames[i]!
    const dtSec = (cur.timestampMs - prev.timestampMs) / 1000
    if (!Number.isFinite(dtSec) || dtSec <= 0 || dtSec > MAX_DT_SEC) continue
    const deltaM = cur.suspensionMeters[corner] - prev.suspensionMeters[corner]
    const pos = cur.suspension[corner]
    if (!Number.isFinite(deltaM) || !Number.isFinite(pos)) continue
    all.push({ pos, vel: (deltaM / dtSec) * 1000 })
  }
  if (cap <= 0 || all.length <= cap) return all
  const stride = Math.ceil(all.length / cap)
  const out: DamperScatterPoint[] = []
  for (let i = 0; i < all.length; i += stride) out.push(all[i]!)
  return out
}

/**
 * Compute all four corner scatters from one set of frames. Returns null if
 * any corner produces no usable points (lap too short / all pause edges) —
 * mirrors damperHistogramsForLap's all-or-nothing contract.
 */
export function damperScatterForLap(
  frames: Telemetry[],
  cap: number = DEFAULT_SCATTER_CAP
): { fl: DamperScatterPoint[], fr: DamperScatterPoint[], rl: DamperScatterPoint[], rr: DamperScatterPoint[] } | null {
  const fl = damperScatterFromFrames(frames, 'fl', cap)
  const fr = damperScatterFromFrames(frames, 'fr', cap)
  const rl = damperScatterFromFrames(frames, 'rl', cap)
  const rr = damperScatterFromFrames(frames, 'rr', cap)
  if (!fl.length || !fr.length || !rl.length || !rr.length) return null
  return { fl, fr, rl, rr }
}
