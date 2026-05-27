import type { MeasurementBand } from '../../server/utils/forza-bus'

/**
 * Merge a freshly-received set of in-window bands into the client's running
 * list, keyed by `startMs`.
 *
 * The server re-sends every band currently inside its rolling window on each
 * emit, so:
 *   - an in-progress band arrives repeatedly with a growing `endMs` → upsert
 *     by `startMs` replaces the stale copy with the longer one;
 *   - completed bands keep arriving unchanged until they scroll out of the
 *     window → we drop any whose `endMs` has aged past `windowStartMs`.
 *
 * Pure + sorted-by-startMs output so the strip renders left-to-right.
 */
export function mergeBands(
  existing: MeasurementBand[],
  incoming: MeasurementBand[],
  windowStartMs: number
): MeasurementBand[] {
  const byStart = new Map<number, MeasurementBand>()
  for (const b of existing) byStart.set(b.startMs, b)
  for (const b of incoming) byStart.set(b.startMs, b)
  return [...byStart.values()]
    .filter(b => b.endMs >= windowStartMs)
    .sort((a, b) => a.startMs - b.startMs)
}
