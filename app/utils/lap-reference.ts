/**
 * Reference-lap lookup: clock time at a given lap distance.
 *
 * A reference is the fastest completed lap so far in the session, built from
 * (distance, clockMs) pairs sampled at telemetry rate (~60Hz). For a one-
 * minute lap that's ~3600 samples / ~85KB of floats — tractable to keep in
 * memory and binary-search per frame.
 *
 * Pure module: no Vue, no telemetry types, trivially testable.
 */

export interface LapReferenceSample {
  /** meters since lap start (monotonic) */
  distance: number
  /** ms since lap start */
  clockMs: number
}

export interface LapReference {
  /** Strictly distance-increasing samples, clocks normalised so samples[0].clockMs === 0. */
  samples: LapReferenceSample[]
  totalDistanceM: number
  totalMs: number
  /** Equal-distance sector times, ms. Default 3 sectors. */
  sectorMs: number[]
}

/**
 * Build a reference from raw frame samples. Filters non-increasing distance
 * (Forza occasionally jitters by a millimetre across frames). Returns null
 * if the lap is too short, too sparse, or has degenerate timing.
 */
export function buildLapReference(
  raw: LapReferenceSample[],
  sectorCount = 3
): LapReference | null {
  if (sectorCount < 1) return null
  if (raw.length < 2) return null

  const cleaned: LapReferenceSample[] = []
  let lastD = -Infinity
  for (const s of raw) {
    if (s.distance > lastD) {
      cleaned.push({ distance: s.distance, clockMs: s.clockMs })
      lastD = s.distance
    }
  }
  if (cleaned.length < 2) return null

  const first = cleaned[0]!
  const last = cleaned[cleaned.length - 1]!
  const totalDistanceM = last.distance - first.distance
  const totalMs = last.clockMs - first.clockMs
  if (!Number.isFinite(totalDistanceM) || totalDistanceM <= 0) return null
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null

  // Normalise clocks so samples[0].clockMs === 0 — caller's queries are
  // always lap-relative, so we save a subtraction per lookup.
  const clockBase = first.clockMs
  const distanceBase = first.distance
  for (const s of cleaned) {
    s.clockMs -= clockBase
    s.distance -= distanceBase
  }

  // Sector boundaries at equal distance fractions.
  const boundaryClock: number[] = new Array(sectorCount).fill(totalMs)
  let bi = 0
  for (let i = 0; i < cleaned.length && bi < sectorCount; i++) {
    const d = cleaned[i]!.distance
    while (bi < sectorCount && d >= totalDistanceM * (bi + 1) / sectorCount) {
      boundaryClock[bi] = cleaned[i]!.clockMs
      bi++
    }
  }
  const sectorMs: number[] = new Array(sectorCount)
  sectorMs[0] = Math.round(boundaryClock[0]!)
  for (let i = 1; i < sectorCount; i++) {
    sectorMs[i] = Math.round(boundaryClock[i]! - boundaryClock[i - 1]!)
  }

  return { samples: cleaned, totalDistanceM, totalMs, sectorMs }
}

/**
 * Reference clock at the given lap distance. Linear interpolation between
 * the two bracketing samples. Returns null when the distance is outside the
 * reference's range (e.g. you've travelled further than the reference did,
 * which means the rolling delta is undefined for this frame).
 */
export function referenceClockAt(ref: LapReference, distance: number): number | null {
  const ss = ref.samples
  const first = ss[0]!
  const last = ss[ss.length - 1]!
  if (distance < first.distance) return null
  if (distance > last.distance) return null

  // Binary search for the greatest sample with distance <= target.
  let lo = 0
  let hi = ss.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1
    if (ss[mid]!.distance <= distance) lo = mid
    else hi = mid
  }
  const a = ss[lo]!
  const b = ss[hi]!
  if (b.distance === a.distance) return a.clockMs
  const t = (distance - a.distance) / (b.distance - a.distance)
  return a.clockMs + (b.clockMs - a.clockMs) * t
}
