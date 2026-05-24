import { describe, it, expect } from 'vitest'
import { buildLapReference, referenceClockAt } from '../../app/utils/lap-reference'

describe('buildLapReference', () => {
  it('returns null for too-short input', () => {
    expect(buildLapReference([])).toBeNull()
    expect(buildLapReference([{ distance: 0, clockMs: 0 }])).toBeNull()
  })

  it('returns null when total distance or time is non-positive', () => {
    expect(buildLapReference([
      { distance: 0, clockMs: 0 },
      { distance: 0, clockMs: 1000 }
    ])).toBeNull()
    expect(buildLapReference([
      { distance: 0, clockMs: 0 },
      { distance: 100, clockMs: 0 }
    ])).toBeNull()
  })

  it('filters non-increasing distance samples', () => {
    const ref = buildLapReference([
      { distance: 0, clockMs: 0 },
      { distance: 100, clockMs: 1000 },
      { distance: 100, clockMs: 1500 }, // duplicate distance
      { distance: 90, clockMs: 2000 }, // backward
      { distance: 200, clockMs: 2500 }
    ])
    expect(ref).not.toBeNull()
    expect(ref!.samples.length).toBe(3)
  })

  it('normalises samples so the first clock is 0', () => {
    const ref = buildLapReference([
      { distance: 500, clockMs: 1_700_000 },
      { distance: 1000, clockMs: 1_710_000 }
    ])!
    expect(ref.samples[0]!.distance).toBe(0)
    expect(ref.samples[0]!.clockMs).toBe(0)
    expect(ref.totalDistanceM).toBe(500)
    expect(ref.totalMs).toBe(10_000)
  })

  it('computes equal-distance sector splits', () => {
    // Constant-speed lap: 3000m in 60s. Sectors should each be 20s.
    const samples = Array.from({ length: 301 }, (_, i) => ({
      distance: i * 10,
      clockMs: i * 200
    }))
    const ref = buildLapReference(samples, 3)!
    expect(ref.sectorMs).toHaveLength(3)
    expect(ref.sectorMs[0]).toBeCloseTo(20_000, -1)
    expect(ref.sectorMs[1]).toBeCloseTo(20_000, -1)
    expect(ref.sectorMs[2]).toBeCloseTo(20_000, -1)
  })
})

describe('referenceClockAt', () => {
  const ref = buildLapReference([
    { distance: 0, clockMs: 0 },
    { distance: 1000, clockMs: 30_000 },
    { distance: 2000, clockMs: 60_000 }
  ])!

  it('returns null when distance is outside the reference range', () => {
    expect(referenceClockAt(ref, -1)).toBeNull()
    expect(referenceClockAt(ref, 2001)).toBeNull()
  })

  it('returns the exact sample clock at sample boundaries', () => {
    expect(referenceClockAt(ref, 0)).toBe(0)
    expect(referenceClockAt(ref, 1000)).toBe(30_000)
    expect(referenceClockAt(ref, 2000)).toBe(60_000)
  })

  it('linearly interpolates between samples', () => {
    expect(referenceClockAt(ref, 500)).toBe(15_000)
    expect(referenceClockAt(ref, 1500)).toBe(45_000)
  })
})
