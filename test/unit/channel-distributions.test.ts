import { describe, expect, it } from 'vitest'
import {
  rpmDistribution,
  slipAngleBalanceDistribution,
  tireTempDistributions,
  slipRatioDistributions
} from '../../app/utils/channel-distributions'
import type { Telemetry } from '../../server/utils/decode'

/** Minimal frame factory — only the channels the distribution module reads
 *  are exposed as options; everything else defaults to zero. */
function frame(opts: {
  rpm?: number
  rpmMax?: number
  latG?: number // acceleration.z
  saFL?: number
  saFR?: number
  saRL?: number
  saRR?: number
  ttFL?: number
  ttFR?: number
  ttRL?: number
  ttRR?: number
  srFL?: number
  srFR?: number
  srRL?: number
  srRR?: number
}): Telemetry {
  return {
    isRaceOn: true,
    timestampMs: 0,
    rpm: opts.rpm ?? 0, rpmMax: opts.rpmMax ?? 0, rpmIdle: 0,
    speedKmh: 0, power: 0, torque: 0, boost: 0,
    gear: 1, throttle: 0, brake: 0, clutch: 0, handBrake: 0, steer: 0,
    drivingLine: 0, aiBrakeDifference: 0,
    suspension: { fl: 0, fr: 0, rl: 0, rr: 0 },
    suspensionMeters: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipRatio: {
      fl: opts.srFL ?? 0, fr: opts.srFR ?? 0, rl: opts.srRL ?? 0, rr: opts.srRR ?? 0
    },
    slipAngle: {
      fl: opts.saFL ?? 0, fr: opts.saFR ?? 0, rl: opts.saRL ?? 0, rr: opts.saRR ?? 0
    },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    tireTempC: {
      fl: opts.ttFL ?? 0, fr: opts.ttFR ?? 0, rl: opts.ttRL ?? 0, rr: opts.ttRR ?? 0
    },
    wheelRotation: { fl: 0, fr: 0, rl: 0, rr: 0 },
    rumble: { fl: false, fr: false, rl: false, rr: false },
    puddle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    yaw: 0, pitch: 0, roll: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: opts.latG ?? 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    car: { ordinal: 1, class: 5, pi: 800, drivetrain: 2, cylinders: 8 },
    lap: { number: 1, racePosition: 1, current: 0, last: 0, best: 0, raceTime: 0, distance: 0 },
    fuel: 1,
    rawLength: 324
  }
}

describe('rpmDistribution', () => {
  it('returns null when no frame carries usable RPM', () => {
    expect(rpmDistribution([frame({ rpm: 0 })])).toBeNull()
  })

  it('spans 0 to the redline rounded up to the next 1000', () => {
    const h = rpmDistribution([
      frame({ rpm: 3000, rpmMax: 7500 }),
      frame({ rpm: 6000, rpmMax: 7500 })
    ])!
    expect(h.binEdges[0]).toBe(0)
    expect(h.binEdges[h.binEdges.length - 1]).toBe(8000) // 7500 → 8000
    expect(h.totalSamples).toBe(2)
  })

  it('falls back to max observed rpm when rpmMax is absent', () => {
    const h = rpmDistribution([frame({ rpm: 4200, rpmMax: 0 })])!
    expect(h.binEdges[h.binEdges.length - 1]).toBe(5000) // 4200 → 5000
  })
})

describe('slipAngleBalanceDistribution', () => {
  it('ignores straight-line frames (below the cornering gate)', () => {
    // High slip but no lateral G → not cornering → dropped.
    expect(slipAngleBalanceDistribution([
      frame({ saFL: 0.2, saFR: 0.2, latG: 0 })
    ])).toBeNull()
  })

  it('reads positive balance when fronts slip more than rears (understeer)', () => {
    // front 0.1 rad, rear 0 → +5.73° balance, cornering.
    const h = slipAngleBalanceDistribution([
      frame({ saFL: 0.1, saFR: 0.1, saRL: 0, saRR: 0, latG: 5 })
    ])!
    expect(h.totalSamples).toBe(1)
    // The single sample (~+5.7°) lands right of the zero edge.
    const zeroIdx = h.binEdges.findIndex(e => e === 0)
    let countAtOrAfterZero = 0
    for (let i = zeroIdx; i < h.counts.length; i++) countAtOrAfterZero += h.counts[i]!
    expect(countAtOrAfterZero).toBe(1)
  })

  it('reads negative balance when rears slip more (oversteer)', () => {
    const h = slipAngleBalanceDistribution([
      frame({ saFL: 0, saFR: 0, saRL: 0.1, saRR: 0.1, latG: 5 })
    ])!
    const zeroIdx = h.binEdges.findIndex(e => e === 0)
    let countBeforeZero = 0
    for (let i = 0; i < zeroIdx; i++) countBeforeZero += h.counts[i]!
    expect(countBeforeZero).toBe(1)
  })
})

describe('tireTempDistributions', () => {
  it('returns a histogram per corner on the fixed 40-130 scale', () => {
    const out = tireTempDistributions([
      frame({ ttFL: 88, ttFR: 92, ttRL: 80, ttRR: 84 }),
      frame({ ttFL: 90, ttFR: 95, ttRL: 82, ttRR: 86 })
    ])!
    expect(out.fl.binEdges[0]).toBe(40)
    expect(out.fl.binEdges[out.fl.binEdges.length - 1]).toBe(130)
    expect(out.fl.totalSamples).toBe(2)
    expect(out.rr.totalSamples).toBe(2)
  })

  it('clamps out-of-range temps into the end bins', () => {
    const out = tireTempDistributions([frame({ ttFL: 200 })])!
    expect(out.fl.counts[out.fl.counts.length - 1]!).toBe(1)
  })

  it('returns null for no frames', () => {
    expect(tireTempDistributions([])).toBeNull()
  })
})

describe('slipRatioDistributions', () => {
  it('reads signed slip per wheel on the −1..1 scale', () => {
    const out = slipRatioDistributions([
      frame({ srFL: 0.3, srFR: -0.3, srRL: 0, srRR: 0.1 })
    ])!
    expect(out.fl.binEdges[0]).toBe(-1)
    expect(out.fl.binEdges[out.fl.binEdges.length - 1]).toBe(1)
    expect(out.fl.totalSamples).toBe(1)
  })

  it('returns null for no frames', () => {
    expect(slipRatioDistributions([])).toBeNull()
  })
})
