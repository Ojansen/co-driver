import { describe, expect, it } from 'vitest'
import {
  buildGearingChart,
  emptyGearingState,
  ingestGearingFrame,
  snapshotGearing
} from '../../app/utils/gearing'
import type { GearingModel } from '../../app/utils/gearing'
import type { DynoCurve } from '../../app/utils/dyno'
import type { Quad, Telemetry } from '../../server/utils/decode'

const RPM_TO_RADS = Math.PI / 30

function quad(v: number): Quad {
  return { fl: v, fr: v, rl: v, rr: v }
}

/**
 * Frame fixture for a steady pull in one gear. `ratio` and `radius` define the
 * synthetic drivetrain; wheel rotation is back-computed so the deriver should
 * recover exactly those values. RWD by default.
 */
function gearFrame(opts: {
  gear: number
  rpm: number
  ratio: number
  radius?: number
  drivetrain?: number
  clutch?: number
  slip?: number
  torque?: number
}): Telemetry {
  const radius = opts.radius ?? 0.3
  const drivetrain = opts.drivetrain ?? 1
  const wWheel = (opts.rpm * RPM_TO_RADS) / opts.ratio
  const speedKmh = wWheel * radius * 3.6
  return {
    gear: opts.gear,
    rpm: opts.rpm,
    rpmIdle: 800,
    rpmMax: 8000,
    clutch: opts.clutch ?? 0,
    throttle: 1,
    speedKmh,
    torque: opts.torque ?? 400,
    power: 0,
    wheelRotation: quad(wWheel),
    slipRatio: quad(opts.slip ?? 0),
    car: { ordinal: 1, class: 5, pi: 800, drivetrain, cylinders: 8 }
  } as Telemetry
}

describe('ingestGearingFrame / snapshotGearing', () => {
  it('recovers the combined ratio and rolling radius from clean frames', () => {
    const state = emptyGearingState()
    for (let i = 0; i < 6; i++) {
      ingestGearingFrame(state, gearFrame({ gear: 3, rpm: 5000, ratio: 8, radius: 0.31 }))
    }
    const model = snapshotGearing(state)
    expect(model.gears).toHaveLength(1)
    expect(model.gears[0]!.gear).toBe(3)
    expect(model.gears[0]!.ratio).toBeCloseTo(8, 5)
    expect(model.tireRadiusM).toBeCloseTo(0.31, 5)
    expect(model.drivetrain).toBe(1)
  })

  it('ignores frames with a slipping clutch, neutral, or reverse', () => {
    const state = emptyGearingState()
    ingestGearingFrame(state, gearFrame({ gear: 3, rpm: 5000, ratio: 8, clutch: 0.5 }))
    ingestGearingFrame(state, gearFrame({ gear: 11, rpm: 5000, ratio: 8 })) // neutral mid-shift
    ingestGearingFrame(state, gearFrame({ gear: 0, rpm: 5000, ratio: 8 })) // reverse
    expect(snapshotGearing(state).gears).toHaveLength(0)
  })

  it('does not trust a gear below the minimum sample count', () => {
    const state = emptyGearingState()
    ingestGearingFrame(state, gearFrame({ gear: 2, rpm: 4000, ratio: 10 }))
    ingestGearingFrame(state, gearFrame({ gear: 2, rpm: 4000, ratio: 10 }))
    expect(snapshotGearing(state).gears).toHaveLength(0)
  })

  it('recovers ratio under wheelspin but skips the radius read', () => {
    const state = emptyGearingState()
    // Driven (rear) wheels spin fast; speed is set independently so the radius
    // read would be wrong — slip gate must reject it. Ratio still holds.
    for (let i = 0; i < 6; i++) {
      const f = gearFrame({ gear: 2, rpm: 6000, ratio: 12, slip: 0.4 })
      ingestGearingFrame(state, f)
    }
    const model = snapshotGearing(state)
    expect(model.gears[0]!.ratio).toBeCloseTo(12, 5)
    expect(model.tireRadiusM).toBeNull() // every radius sample slip-gated out
  })

  it('is a no-op without the FH6 wheelRotation channel', () => {
    const state = emptyGearingState()
    const f = gearFrame({ gear: 3, rpm: 5000, ratio: 8 })
    ingestGearingFrame(state, { ...f, wheelRotation: null } as Telemetry)
    expect(snapshotGearing(state).gears).toHaveLength(0)
  })
})

describe('buildGearingChart', () => {
  const dyno: DynoCurve = {
    buckets: [
      { rpm: 2000, maxTorqueNm: 300, maxPowerKw: 63, maxBoostAtm: 0, samples: 5 },
      { rpm: 4000, maxTorqueNm: 400, maxPowerKw: 168, maxBoostAtm: 0, samples: 5 },
      { rpm: 6000, maxTorqueNm: 350, maxPowerKw: 220, maxBoostAtm: 0, samples: 5 }
    ],
    peakTorque: { rpm: 4000, value: 400 },
    peakPower: { rpm: 6000, value: 220 },
    peakBoost: null,
    rpmIdle: 800,
    rpmMax: 6500
  }

  const model: GearingModel = {
    gears: [
      { gear: 1, ratio: 12, samples: 20 },
      { gear: 2, ratio: 8, samples: 20 }
    ],
    tireRadiusM: 0.3,
    drivetrain: 1
  }

  it('maps force and speed per gear with radius cancelling out of the force ratio', () => {
    const chart = buildGearingChart(dyno, model)
    expect(chart.hasForce).toBe(true)
    expect(chart.traces).toHaveLength(2)

    // Force at the contact patch = torque · ratio / radius.
    const g1 = chart.traces[0]!
    const peak = g1.points.find(p => p.rpm === 4000)!
    expect(peak.forceN).toBeCloseTo((400 * 12) / 0.3, 3)

    // Shorter gear (1) always makes more force at the same rpm than gear 2.
    const g2 = chart.traces[1]!
    expect(g1.points[1]!.forceN).toBeGreaterThan(g2.points[1]!.forceN)

    // Wheel power equals engine power regardless of gear.
    expect(g1.points[2]!.powerKw).toBe(220)
    expect(g2.points[2]!.powerKw).toBe(220)
  })

  it('places a higher gear at a higher speed for the same rpm', () => {
    const chart = buildGearingChart(dyno, model)
    const g1at6000 = chart.traces[0]!.points.find(p => p.rpm === 6000)!
    const g2at6000 = chart.traces[1]!.points.find(p => p.rpm === 6000)!
    expect(g2at6000.speedKmh).toBeGreaterThan(g1at6000.speedKmh)
  })

  it('falls back to power-only when torque is unavailable', () => {
    const chart = buildGearingChart({ ...dyno, peakTorque: null }, model)
    expect(chart.hasForce).toBe(false)
  })
})
