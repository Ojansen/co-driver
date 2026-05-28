/**
 * Generic 1-D histogram binning, shared by the suspension views:
 *   - damper-velocity.ts layers velocity-zone shares on top
 *   - ride-height.ts layers position-band shares on top
 *
 * Pure, no domain knowledge. Bin assignment uses [edge[i], edge[i+1]) —
 * left-inclusive, right-exclusive — except the last bin which is
 * [edge[N-1], edge[N]] (both inclusive) so the maximum value lands in the
 * last bin rather than being dropped. Values outside [min, max] are clamped
 * into the first / last bins rather than dropped, so "you spent time past
 * the edge" is preserved instead of silently hidden.
 */

export interface BinnedValues {
  /** N+1 edges defining N bins. Copy of the input edges. */
  binEdges: number[]
  /** Sample count per bin, length N. */
  counts: number[]
  /** Total samples (sum of counts). */
  totalSamples: number
  /** Index of the bin with the highest count. */
  peakBinIndex: number
  /** counts[peakBinIndex] / totalSamples — 0..1. */
  peakPct: number
}

/**
 * Bucket `values` into the bins defined by `binEdges`. Returns null if
 * `values` is empty or `binEdges` has fewer than 2 entries (no valid bins).
 */
export function binValues(
  values: number[],
  binEdges: readonly number[]
): BinnedValues | null {
  if (values.length === 0) return null
  if (binEdges.length < 2) return null

  const edges = [...binEdges]
  const n = edges.length - 1
  const counts = new Array<number>(n).fill(0)

  for (const v of values) {
    if (!Number.isFinite(v)) continue
    // Clamp to bin range so extremes count rather than vanish.
    let idx: number
    if (v <= edges[0]!) {
      idx = 0
    } else if (v >= edges[n]!) {
      idx = n - 1
    } else {
      // Linear scan is fine here — N is small (≈10-14).
      idx = 0
      for (let i = 0; i < n; i++) {
        if (v >= edges[i]! && v < edges[i + 1]!) {
          idx = i
          break
        }
      }
    }
    counts[idx]!++
  }

  let totalSamples = 0
  for (const c of counts) totalSamples += c

  let peakBinIndex = 0
  let peakCount = 0
  for (let i = 0; i < counts.length; i++) {
    if (counts[i]! > peakCount) {
      peakCount = counts[i]!
      peakBinIndex = i
    }
  }
  const peakPct = totalSamples > 0 ? peakCount / totalSamples : 0

  return { binEdges: edges, counts, totalSamples, peakBinIndex, peakPct }
}
