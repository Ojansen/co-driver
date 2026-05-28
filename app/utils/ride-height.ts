/**
 * Ride-height histogram — how much time the chassis spends at each
 * suspension-travel band over a lap (or N laps). The position-domain
 * companion to the damper-velocity histogram: where the velocity view reads
 * *how fast* the suspension moves, this reads *where it sits*.
 *
 * Reading the shape:
 *   - Bars piled to the left (droop): car rides high / lightly loaded
 *   - Bars piled to the right (compressed): car rides low — watch the
 *     aero platform and the bottoming band
 *   - Front vs rear / left vs right asymmetry: uneven static or dynamic
 *     load distribution
 *
 * Bins the normalized `suspension` field (0 = full droop, 1 = bottomed) — the
 * same field summarizeSuspensionTravel reads. Bounded 0..1, so fixed bin
 * edges work across every car. The top band (>0.95) is the same bottoming
 * threshold the /tune/ride-height "Your data" panel already reports.
 *
 * Pure module — caller pre-filters frames to the lap window.
 */

import type { Telemetry } from '../../server/utils/decode'
import type { Corner } from './damper-velocity'
import { binValues } from './histogram-core'

export interface RideHeightHistogram {
  /** N+1 edges defining N bins (0 .. 1). */
  binEdges: number[]
  /** Sample count per bin, length N. */
  counts: number[]
  totalSamples: number
  peakBinIndex: number
  peakPct: number
  /** Time-share in each travel band. Sum is 1.0 (within rounding). */
  droopPct: number // ≤ 0.25 — extended, lightly loaded
  midPct: number // 0.25 .. 0.75 — normal working range
  compressedPct: number // 0.75 .. 0.95 — heavily loaded
  bottomingPct: number // > 0.95 — out of travel
}

/** Ten even bins across the full normalized travel range. */
export const DEFAULT_RH_BIN_EDGES: readonly number[] = [
  0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0
]

/** Band boundaries — kept here so the readout and any copy stay in sync. */
const DROOP_MAX = 0.25
const MID_MAX = 0.75
const BOTTOMING_MIN = 0.95

/** Per-frame normalized travel for a corner. Thin wrapper for symmetry with
 *  damperVelocityFromFrames; no dt logic needed since position is absolute. */
export function rideHeightFromFrames(frames: Telemetry[], corner: Corner): number[] {
  const out: number[] = []
  for (const f of frames) {
    const v = f.suspension[corner]
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

/**
 * Bin one corner's travel samples and layer the band time-shares on top.
 * Returns null when there are no usable samples.
 */
export function computeRideHeightHistogram(
  travel: number[],
  binEdges: readonly number[] = DEFAULT_RH_BIN_EDGES
): RideHeightHistogram | null {
  const binned = binValues(travel, binEdges)
  if (!binned) return null

  let droop = 0
  let mid = 0
  let compressed = 0
  let bottoming = 0
  for (const v of travel) {
    if (!Number.isFinite(v)) continue
    if (v > BOTTOMING_MIN) bottoming++
    else if (v > MID_MAX) compressed++
    else if (v > DROOP_MAX) mid++
    else droop++
  }
  const tot = travel.length || 1

  return {
    binEdges: binned.binEdges,
    counts: binned.counts,
    totalSamples: binned.totalSamples,
    peakBinIndex: binned.peakBinIndex,
    peakPct: binned.peakPct,
    droopPct: droop / tot,
    midPct: mid / tot,
    compressedPct: compressed / tot,
    bottomingPct: bottoming / tot
  }
}

/** One corner's histogram straight from frames. */
export function rideHeightHistogram(
  frames: Telemetry[],
  corner: Corner,
  binEdges: readonly number[] = DEFAULT_RH_BIN_EDGES
): RideHeightHistogram | null {
  return computeRideHeightHistogram(rideHeightFromFrames(frames, corner), binEdges)
}

/**
 * All four corner histograms from one set of frames. Returns null if any
 * corner produces no usable samples — mirrors damperHistogramsForLap.
 */
export function rideHeightHistogramsForLap(
  frames: Telemetry[],
  binEdges: readonly number[] = DEFAULT_RH_BIN_EDGES
): { fl: RideHeightHistogram, fr: RideHeightHistogram, rl: RideHeightHistogram, rr: RideHeightHistogram } | null {
  const fl = rideHeightHistogram(frames, 'fl', binEdges)
  const fr = rideHeightHistogram(frames, 'fr', binEdges)
  const rl = rideHeightHistogram(frames, 'rl', binEdges)
  const rr = rideHeightHistogram(frames, 'rr', binEdges)
  if (!fl || !fr || !rl || !rr) return null
  return { fl, fr, rl, rr }
}
