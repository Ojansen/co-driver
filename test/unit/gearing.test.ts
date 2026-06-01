import { describe, expect, it } from 'vitest'
import {
  emptyGearingState,
  ingestGearingFrame,
  snapshotGearing
} from '../../app/utils/gearing'
import type { Telemetry } from '../../server/utils/decode'

const G = 9.80665

/** Frame fixture — only the channels the gearing binner reads. */
function frame(overrides: Partial<Telemetry> = {}): Telemetry {
  return {
    timestampMs: 0,
    speedKmh: 0,
    power: 0,
    gear: 2,
    throttle: 1,
    ...overrides
  } as Telemetry
}

/**
 * A constant-acceleration WOT pull in one gear. `aMps2` is the longitudinal
 * acceleration; frames are `dtMs` apart with `power` (W) held flat.
 */
function pull(opts: {
  gear: number
  v0Kmh: number
  aMps2: number
  dtMs: number
  n: number
  powerW: number
}): Telemetry[] {
  const out: Telemetry[] = []
  const dtS = opts.dtMs / 1000
  let vMps = opts.v0Kmh / 3.6
  for (let i = 0; i < opts.n; i++) {
    out.push(frame({
      timestampMs: i * opts.dtMs,
      speedKmh: vMps * 3.6,
      power: opts.powerW,
      gear: opts.gear,
      throttle: 1
    }))
    vMps += opts.aMps2 * dtS
  }
  return out
}

describe('ingestGearingFrame / snapshotGearing', () => {
  it('bins measured power and longitudinal g by gear across a shared speed axis', () => {
    const state = emptyGearingState()
    // ~0.5 g pull in 3rd gear from 60 km/h, 50 ms frames.
    for (const f of pull({ gear: 3, v0Kmh: 60, aMps2: 0.5 * G, dtMs: 50, n: 40, powerW: 150_000 })) {
      ingestGearingFrame(state, f)
    }
    const grid = snapshotGearing(state)

    expect(grid.hasAccel).toBe(true)
    expect(grid.hasPower).toBe(true)
    expect(grid.series).toHaveLength(1)
    expect(grid.series[0]!.gear).toBe(3)

    // Constant 0.5 g pull → mean g ≈ 0.5 everywhere it's populated.
    expect(grid.maxAccelG).toBeCloseTo(0.5, 2)
    // Flat 150 kW.
    expect(grid.maxPowerKw).toBeCloseTo(150, 5)

    // Every series is aligned to the shared speed grid.
    expect(grid.speedsKmh.length).toBeGreaterThan(0)
    for (const s of grid.series) {
      expect(s.accelG).toHaveLength(grid.speedsKmh.length)
      expect(s.power).toHaveLength(grid.speedsKmh.length)
    }
    // Ascending speed axis.
    for (let i = 1; i < grid.speedsKmh.length; i++) {
      expect(grid.speedsKmh[i]!).toBeGreaterThan(grid.speedsKmh[i - 1]!)
    }
  })

  it('places each gear on the same speed axis with gaps where it has no samples', () => {
    const state = emptyGearingState()
    for (const f of pull({ gear: 2, v0Kmh: 40, aMps2: 0.6 * G, dtMs: 50, n: 20, powerW: 120_000 })) {
      ingestGearingFrame(state, f)
    }
    for (const f of pull({ gear: 4, v0Kmh: 120, aMps2: 0.25 * G, dtMs: 50, n: 20, powerW: 140_000 })) {
      ingestGearingFrame(state, f)
    }
    const grid = snapshotGearing(state)
    expect(grid.series.map(s => s.gear)).toEqual([2, 4])

    const g2 = grid.series[0]!
    const g4 = grid.series[1]!
    // Low-speed buckets belong to gear 2 only; high-speed to gear 4 only.
    const lowIdx = grid.speedsKmh.findIndex(s => s <= 44)
    const highIdx = grid.speedsKmh.findIndex(s => s >= 124)
    expect(g2.power[lowIdx]).not.toBeNull()
    expect(g4.power[lowIdx]).toBeNull()
    expect(g4.power[highIdx]).not.toBeNull()
    expect(g2.power[highIdx]).toBeNull()
  })

  it('excludes part-throttle frames, neutral and reverse', () => {
    const state = emptyGearingState()
    ingestGearingFrame(state, frame({ timestampMs: 0, speedKmh: 50, power: 100_000, gear: 3, throttle: 0.5 }))
    ingestGearingFrame(state, frame({ timestampMs: 50, speedKmh: 52, power: 100_000, gear: 3, throttle: 0.5 }))
    ingestGearingFrame(state, frame({ timestampMs: 100, speedKmh: 54, power: 100_000, gear: 11, throttle: 1 }))
    ingestGearingFrame(state, frame({ timestampMs: 150, speedKmh: 56, power: 100_000, gear: 0, throttle: 1 }))
    const grid = snapshotGearing(state)
    expect(grid.series).toHaveLength(0)
    expect(grid.hasPower).toBe(false)
  })

  it('drops the speed derivative across a frame gap (pause), keeping power', () => {
    const state = emptyGearingState()
    ingestGearingFrame(state, frame({ timestampMs: 0, speedKmh: 80, power: 130_000, gear: 4, throttle: 1 }))
    // 5 s later — dt exceeds the gap bound, so no trustworthy g, but power still bins.
    ingestGearingFrame(state, frame({ timestampMs: 5000, speedKmh: 82, power: 130_000, gear: 4, throttle: 1 }))
    const grid = snapshotGearing(state)
    expect(grid.hasPower).toBe(true)
    expect(grid.hasAccel).toBe(false)
  })
})
