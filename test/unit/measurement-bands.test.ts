import { describe, expect, it } from 'vitest'
import type { MeasurementBand } from '../../server/utils/forza-bus'
import { mergeBands } from '../../app/utils/measurement-bands'

const band = (startMs: number, endMs: number): MeasurementBand => ({ startMs, endMs })

describe('mergeBands', () => {
  it('inserts new bands and returns them sorted by startMs', () => {
    const out = mergeBands([], [band(300, 400), band(100, 200)], 0)
    expect(out).toEqual([band(100, 200), band(300, 400)])
  })

  it('upserts by startMs — a re-sent in-progress band replaces the stale shorter copy', () => {
    const existing = [band(100, 200)]
    // Same band, now grown (endMs later) because it is still in progress.
    const out = mergeBands(existing, [band(100, 260)], 0)
    expect(out).toEqual([band(100, 260)])
  })

  it('keeps distinct bands that share no startMs', () => {
    const existing = [band(100, 200)]
    const out = mergeBands(existing, [band(500, 600)], 0)
    expect(out).toEqual([band(100, 200), band(500, 600)])
  })

  it('ages out bands whose endMs has scrolled past the window start', () => {
    const existing = [band(100, 200), band(900, 1000)]
    // windowStartMs = 500 → the first band (ends at 200) drops out.
    const out = mergeBands(existing, [], 500)
    expect(out).toEqual([band(900, 1000)])
  })

  it('keeps a band whose endMs sits exactly on the window start (inclusive)', () => {
    const out = mergeBands([band(100, 500)], [], 500)
    expect(out).toEqual([band(100, 500)])
  })
})
