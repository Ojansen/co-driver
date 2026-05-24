/**
 * Per-sector personal bests across a session.
 *
 * Each sector is tracked independently — your best S1 may come from a
 * different lap than your best S3. Theoretical lap = sum of sector PBs.
 * Pure module, trivially testable.
 */

export interface SectorPBs {
  /** Best time per sector, ms. null entries have never been completed. */
  bestMs: Array<number | null>
}

export function emptySectorPBs(sectorCount = 3): SectorPBs {
  return { bestMs: new Array(sectorCount).fill(null) }
}

/**
 * Returns a new SectorPBs with each entry replaced by the minimum of the
 * existing best and the just-completed time. Non-positive or null entries
 * in `completedMs` are ignored (treated as missing measurements).
 */
export function applyCompletedSectors(
  pbs: SectorPBs,
  completedMs: Array<number | null | undefined>
): SectorPBs {
  return {
    bestMs: pbs.bestMs.map((prev, i) => {
      const next = completedMs[i]
      if (next == null || !Number.isFinite(next) || next <= 0) return prev
      if (prev == null) return next
      return Math.min(prev, next)
    })
  }
}

/** Sum of sector PBs, or null if any sector hasn't been completed yet. */
export function theoreticalLapMs(pbs: SectorPBs): number | null {
  let sum = 0
  for (const v of pbs.bestMs) {
    if (v == null) return null
    sum += v
  }
  return sum
}
