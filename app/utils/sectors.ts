/**
 * Per-lap sector times — equal-distance splits.
 *
 * Each lap is divided into N equal slices of its own `lap.distance`
 * (default N = 3). For each boundary we read the on-frame lap clock
 * (`lap.current`, seconds) or fall back to the wall-clock delta. The
 * result is sector times in milliseconds.
 *
 * Equal-distance splits mean each lap's sector boundaries land at the
 * same percentage of its own track length, so cross-lap comparison is
 * consistent for fixed-track events. Pure module, trivially testable.
 */

import type { Telemetry } from '../../server/utils/decode'

export const DEFAULT_SECTOR_COUNT = 3

/** Lap must cover at least this much distance per sector to produce
 *  meaningful times (i.e. exclude warmups, false starts, single-frame
 *  blobs). 100 m × 3 = 300 m minimum lap length at default N. */
const MIN_SECTOR_LENGTH_M = 100

/**
 * Returns sector times in milliseconds, length === sectorCount.
 * Returns null when the lap is too short or the frames look corrupt.
 */
export function computeSectorTimes(
  frames: Telemetry[],
  sectorCount: number = DEFAULT_SECTOR_COUNT
): number[] | null {
  if (sectorCount < 1) return null
  if (frames.length < 2) return null

  const first = frames[0]!
  const last = frames[frames.length - 1]!
  const d0 = first.lap.distance
  const lapLength = last.lap.distance - d0
  if (!Number.isFinite(lapLength) || lapLength <= 0) return null
  if (lapLength < sectorCount * MIN_SECTOR_LENGTH_M) return null

  // Lap clock at frame i, in ms. Prefer lap.current (seconds), fall back
  // to the timestamp delta from frame 0 — needed when synthetic test
  // fixtures leave lap.current at 0.
  const t0 = first.lap.current > 0 ? first.lap.current * 1000 : 0
  const clockMs = (f: Telemetry): number => {
    if (f.lap.current > 0) return f.lap.current * 1000 - t0
    return f.timestampMs - first.timestampMs
  }

  // For each boundary at L*i/N (i=1..N), find the first frame whose
  // normalized distance reaches it; record its clock time. Linear scan
  // is O(n) total because the boundaries are monotonically increasing.
  const clockAt: number[] = new Array(sectorCount).fill(0)
  let boundaryIdx = 0
  for (let i = 0; i < frames.length && boundaryIdx < sectorCount; i++) {
    const f = frames[i]!
    const d = f.lap.distance - d0
    while (boundaryIdx < sectorCount && d >= lapLength * (boundaryIdx + 1) / sectorCount) {
      clockAt[boundaryIdx] = clockMs(f)
      boundaryIdx++
    }
  }

  // Some boundary never reached (shouldn't happen given the length check
  // above, but defensive): fall back to last frame's clock.
  const lastClock = clockMs(last)
  for (let i = 0; i < sectorCount; i++) {
    if (clockAt[i] === 0 && i > 0) clockAt[i] = lastClock
  }

  const out: number[] = new Array(sectorCount)
  out[0] = Math.round(clockAt[0]!)
  for (let i = 1; i < sectorCount; i++) {
    out[i] = Math.round(clockAt[i]! - clockAt[i - 1]!)
  }
  return out
}
