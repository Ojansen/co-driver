import { describe, it, expect } from 'vitest'
import { emptySectorPBs, applyCompletedSectors, theoreticalLapMs } from '../../app/utils/sector-pbs'

describe('emptySectorPBs', () => {
  it('initialises all sectors to null', () => {
    expect(emptySectorPBs(3).bestMs).toEqual([null, null, null])
    expect(emptySectorPBs(5).bestMs).toEqual([null, null, null, null, null])
  })
})

describe('applyCompletedSectors', () => {
  it('seeds null entries from the first completed lap', () => {
    const pbs = applyCompletedSectors(emptySectorPBs(3), [20_000, 25_000, 22_000])
    expect(pbs.bestMs).toEqual([20_000, 25_000, 22_000])
  })

  it('keeps the minimum per sector across laps', () => {
    let pbs = applyCompletedSectors(emptySectorPBs(3), [20_000, 25_000, 22_000])
    pbs = applyCompletedSectors(pbs, [21_000, 24_000, 23_000])
    expect(pbs.bestMs).toEqual([20_000, 24_000, 22_000])
  })

  it('ignores non-positive / non-finite / missing entries', () => {
    let pbs = applyCompletedSectors(emptySectorPBs(3), [20_000, 25_000, 22_000])
    pbs = applyCompletedSectors(pbs, [0, -5, Number.NaN])
    expect(pbs.bestMs).toEqual([20_000, 25_000, 22_000])
    pbs = applyCompletedSectors(pbs, [undefined, null, 21_000])
    expect(pbs.bestMs).toEqual([20_000, 25_000, 21_000])
  })

  it('does not mutate the input', () => {
    const before = emptySectorPBs(3)
    const after = applyCompletedSectors(before, [20_000, 25_000, 22_000])
    expect(before.bestMs).toEqual([null, null, null])
    expect(after).not.toBe(before)
  })
})

describe('theoreticalLapMs', () => {
  it('returns null until every sector has a PB', () => {
    expect(theoreticalLapMs(emptySectorPBs(3))).toBeNull()
    expect(theoreticalLapMs({ bestMs: [20_000, null, 22_000] })).toBeNull()
  })

  it('sums sector PBs when all are present', () => {
    expect(theoreticalLapMs({ bestMs: [20_000, 25_000, 22_000] })).toBe(67_000)
  })
})
