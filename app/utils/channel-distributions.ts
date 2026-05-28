/**
 * Per-channel distributions for the /tune/* reference pages — the position-
 * and balance-domain companions to the damper/ride-height histograms. Each
 * is a time-in-state distribution of a raw telemetry channel over the N-lap
 * window, computed server-side (raw frames stay on the server) and rendered
 * by ChannelHistogram (single channel) or QuadHistogram (per corner).
 *
 * Pro-tool standard: MoTeC / AiM ship channel histograms as a default panel.
 * Measurement-only — the shape is the read; no thresholds, no "fix this".
 *
 * Pure module — caller pre-filters frames to the lap window.
 */

import type { Telemetry } from '../../server/utils/decode'
import { binValues, type BinnedValues } from './histogram-core'

export interface QuadDistribution {
  fl: BinnedValues
  fr: BinnedValues
  rl: BinnedValues
  rr: BinnedValues
}

const RAD_TO_DEG = 180 / Math.PI

/** Evenly-spaced edges: `bins` bins spanning [lo, hi], so length is bins+1. */
function linspaceEdges(lo: number, hi: number, bins: number): number[] {
  const out: number[] = []
  const step = (hi - lo) / bins
  for (let i = 0; i <= bins; i++) out.push(lo + step * i)
  return out
}

/**
 * RPM distribution across the lap — where the engine spends its time relative
 * to the powerband. Edges run 0 → redline (max `rpmMax` observed, rounded up
 * to the next 1000), 12 bins. Returns null if no frames carry usable RPM.
 */
export function rpmDistribution(frames: Telemetry[]): BinnedValues | null {
  let top = 0
  const values: number[] = []
  for (const f of frames) {
    if (Number.isFinite(f.rpm) && f.rpm > 0) values.push(f.rpm)
    if (Number.isFinite(f.rpmMax) && f.rpmMax > top) top = f.rpmMax
  }
  if (values.length === 0) return null
  if (top <= 0) for (const v of values) if (v > top) top = v
  top = Math.ceil(top / 1000) * 1000 || 1000
  return binValues(values, linspaceEdges(0, top, 12))
}

/** Lateral acceleration (m/s²) above which a frame counts as "cornering". */
const CORNERING_LAT_MS2 = 2

/**
 * Understeer / oversteer balance distribution — per-frame (front − rear) slip-
 * angle magnitude, in degrees, over cornering frames only (straight-line
 * frames sit at ~0 and would swamp the center). Positive = front tires
 * sliding more than the rears (push / understeer); negative = rears sliding
 * more (rotation / oversteer). Symmetric ±12° edges, 12 bins.
 *
 * Returns null if no cornering frames are present.
 */
export function slipAngleBalanceDistribution(frames: Telemetry[]): BinnedValues | null {
  const values: number[] = []
  for (const f of frames) {
    if (!Number.isFinite(f.acceleration.z) || Math.abs(f.acceleration.z) < CORNERING_LAT_MS2) continue
    const frontMag = (Math.abs(f.slipAngle.fl) + Math.abs(f.slipAngle.fr)) / 2
    const rearMag = (Math.abs(f.slipAngle.rl) + Math.abs(f.slipAngle.rr)) / 2
    const balanceDeg = (frontMag - rearMag) * RAD_TO_DEG
    if (Number.isFinite(balanceDeg)) values.push(balanceDeg)
  }
  if (values.length === 0) return null
  return binValues(values, linspaceEdges(-12, 12, 12))
}

/**
 * Per-tire temperature distribution (°C). Fixed 40-130 °C range (9 bins of
 * 10°) so the four corners — and successive sessions — read on the same
 * scale; out-of-range samples clamp into the end bins. Returns null if a lap
 * carries no usable temps.
 */
export function tireTempDistributions(frames: Telemetry[]): QuadDistribution | null {
  const edges = linspaceEdges(40, 130, 9)
  const pick = (sel: (f: Telemetry) => number): number[] => {
    const out: number[] = []
    for (const f of frames) {
      const v = sel(f)
      if (Number.isFinite(v)) out.push(v)
    }
    return out
  }
  const fl = binValues(pick(f => f.tireTempC.fl), edges)
  const fr = binValues(pick(f => f.tireTempC.fr), edges)
  const rl = binValues(pick(f => f.tireTempC.rl), edges)
  const rr = binValues(pick(f => f.tireTempC.rr), edges)
  if (!fl || !fr || !rl || !rr) return null
  return { fl, fr, rl, rr }
}

/**
 * Per-wheel longitudinal slip-ratio distribution. Signed: positive = wheel
 * spinning faster than the road (acceleration / wheelspin), negative = slower
 * (braking / lock). Symmetric −1..1 edges, 10 bins. Returns null if a lap
 * carries no usable samples.
 */
export function slipRatioDistributions(frames: Telemetry[]): QuadDistribution | null {
  const edges = linspaceEdges(-1, 1, 10)
  const pick = (sel: (f: Telemetry) => number): number[] => {
    const out: number[] = []
    for (const f of frames) {
      const v = sel(f)
      if (Number.isFinite(v)) out.push(v)
    }
    return out
  }
  const fl = binValues(pick(f => f.slipRatio.fl), edges)
  const fr = binValues(pick(f => f.slipRatio.fr), edges)
  const rl = binValues(pick(f => f.slipRatio.rl), edges)
  const rr = binValues(pick(f => f.slipRatio.rr), edges)
  if (!fl || !fr || !rl || !rr) return null
  return { fl, fr, rl, rr }
}
