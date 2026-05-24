import { describe, expect, it } from 'vitest'
import {
  summarizeSuspensionTravel,
  summarizeSlipAngle,
  summarizeSlipRatioUnderThrottle,
  summarizeTireTemp,
  summarizeBrakeShape,
  summarizeAero,
  summarizeGearing,
  summarizeLateralG,
  summarizePower,
  summarizeBoost,
  rumbleContactPct,
  summarizeFrames
} from '../../app/utils/tune-signals'
import type { Telemetry } from '../../server/utils/decode'

function frame(overrides: Partial<Telemetry> = {}): Telemetry {
  const base: Telemetry = {
    isRaceOn: true,
    timestampMs: 0,
    rpm: 4000,
    rpmMax: 8000,
    rpmIdle: 900,
    speedKmh: 50,
    power: 0,
    torque: 0,
    boost: 0,
    gear: 3,
    throttle: 0,
    brake: 0,
    clutch: 0,
    handBrake: 0,
    steer: 0,
    drivingLine: 0,
    aiBrakeDifference: 0,
    suspension: { fl: 0.4, fr: 0.4, rl: 0.4, rr: 0.4 },
    suspensionMeters: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    tireTempC: { fl: 90, fr: 90, rl: 90, rr: 90 },
    wheelRotation: { fl: 0, fr: 0, rl: 0, rr: 0 },
    rumble: { fl: false, fr: false, rl: false, rr: false },
    puddle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    yaw: 0, pitch: 0, roll: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    car: { ordinal: 1, class: 5, pi: 800, drivetrain: 2, cylinders: 8 },
    lap: { number: 1, racePosition: 1, current: 0, last: 0, best: 0, raceTime: 0, distance: 0 },
    fuel: 1,
    rawLength: 324
  }
  return { ...base, ...overrides }
}

describe('summarizeSuspensionTravel', () => {
  it('returns natural zeros on empty input', () => {
    const s = summarizeSuspensionTravel([])
    expect(s.frontAvg).toBe(0)
    expect(s.bottomingPct).toBe(0)
  })

  it('averages travel across axles and counts bottoming', () => {
    const frames = [
      frame({ suspension: { fl: 0.5, fr: 0.5, rl: 0.3, rr: 0.3 } }),
      frame({ suspension: { fl: 0.96, fr: 0.5, rl: 0.3, rr: 0.3 } }), // bottoms
      frame({ suspension: { fl: 0.5, fr: 0.5, rl: 0.3, rr: 0.3 } })
    ]
    const s = summarizeSuspensionTravel(frames)
    expect(s.frontAvg).toBeCloseTo((0.5 + (0.96 + 0.5) / 2 + 0.5) / 3, 3)
    expect(s.rearAvg).toBeCloseTo(0.3, 3)
    expect(s.bottomingPct).toBeCloseTo(1 / 3, 3)
  })

  it('oscillation rises with frame-to-frame travel chatter', () => {
    const calm = Array.from({ length: 30 }, () =>
      frame({ suspension: { fl: 0.4, fr: 0.4, rl: 0.4, rr: 0.4 } }))
    const chatty = Array.from({ length: 30 }, (_, i) =>
      frame({ suspension: { fl: i % 2 === 0 ? 0.2 : 0.7, fr: i % 2 === 0 ? 0.2 : 0.7, rl: 0.4, rr: 0.4 } }))
    expect(summarizeSuspensionTravel(chatty).oscillation).toBeGreaterThan(summarizeSuspensionTravel(calm).oscillation)
  })
})

describe('summarizeSlipAngle', () => {
  it('averages |slip angle| across each axle', () => {
    const frames = [
      frame({ slipAngle: { fl: 0.1, fr: 0.1, rl: -0.2, rr: -0.2 } }),
      frame({ slipAngle: { fl: -0.1, fr: -0.1, rl: 0.2, rr: 0.2 } })
    ]
    const s = summarizeSlipAngle(frames)
    expect(s.frontAvg).toBeCloseTo(0.1, 3)
    expect(s.rearAvg).toBeCloseTo(0.2, 3)
  })
})

describe('summarizeSlipRatioUnderThrottle', () => {
  it('only counts frames at throttle > 0.5', () => {
    const frames = [
      frame({ throttle: 0.0, slipRatio: { fl: 0.5, fr: 0.5, rl: 0.5, rr: 0.5 } }), // ignored
      frame({ throttle: 0.8, slipRatio: { fl: 0.1, fr: 0.1, rl: 0.2, rr: 0.2 } }),
      frame({ throttle: 0.8, slipRatio: { fl: 0.1, fr: 0.1, rl: 0.4, rr: 0.4 } })
    ]
    const s = summarizeSlipRatioUnderThrottle(frames)
    expect(s.throttleFrames).toBe(2)
    expect(s.rl).toBeCloseTo(0.3, 3)
  })

  it('returns zeros when no frame passes the gate', () => {
    expect(summarizeSlipRatioUnderThrottle([frame({ throttle: 0.1 })])).toEqual({
      fl: 0, fr: 0, rl: 0, rr: 0, throttleFrames: 0
    })
  })
})

describe('summarizeTireTemp', () => {
  it('flags allOptimalPct only when every corner is in band', () => {
    const frames = [
      frame({ tireTempC: { fl: 90, fr: 90, rl: 90, rr: 90 } }), // all optimal
      frame({ tireTempC: { fl: 105, fr: 90, rl: 90, rr: 90 } }) // FL too hot
    ]
    const s = summarizeTireTemp(frames)
    expect(s.allOptimalPct).toBe(0.5)
    expect(s.fl).toBeCloseTo(97.5, 3)
  })
})

describe('summarizeBrakeShape', () => {
  it('counts braking events on rising-edge transitions', () => {
    const frames = [
      frame({ timestampMs: 0, brake: 0 }),
      frame({ timestampMs: 16, brake: 0.5 }), // event 1 onset
      frame({ timestampMs: 32, brake: 0.6 }),
      frame({ timestampMs: 200, brake: 0 }),
      frame({ timestampMs: 400, brake: 0.3 }) // event 2 onset
    ]
    const s = summarizeBrakeShape(frames)
    expect(s.brakingEvents).toBe(2)
    expect(s.peakPressure).toBeCloseTo(0.6, 3)
  })

  it('avgEntryPressure averages only the first 200 ms of each event', () => {
    const frames = [
      frame({ timestampMs: 0, brake: 0.5 }), // event 1 start
      frame({ timestampMs: 100, brake: 0.5 }), // still in entry window
      frame({ timestampMs: 300, brake: 0.9 }), // past 200 ms — excluded
      frame({ timestampMs: 500, brake: 0 })
    ]
    const s = summarizeBrakeShape(frames)
    expect(s.avgEntryPressure).toBeCloseTo(0.5, 3)
  })
})

describe('summarizeAero', () => {
  it('reports top speed and high-speed lateral G p95', () => {
    const frames = [
      frame({ speedKmh: 120, acceleration: { x: 0, y: 0, z: 0.5 } }), // below high-speed gate
      frame({ speedKmh: 180, acceleration: { x: 0, y: 0, z: 1.2 } }),
      frame({ speedKmh: 200, acceleration: { x: 0, y: 0, z: 0.8 } })
    ]
    const s = summarizeAero(frames)
    expect(s.topSpeedKmh).toBe(200)
    expect(s.highSpeedFrames).toBe(2)
    expect(s.lateralGP95HighSpeed).toBeGreaterThan(0)
  })
})

describe('summarizeGearing', () => {
  it('counts gear transitions and rev-limit frames', () => {
    const frames = [
      frame({ gear: 3, rpm: 4000, rpmMax: 8000 }),
      frame({ gear: 3, rpm: 7900, rpmMax: 8000 }), // at rev limit (>= 98%)
      frame({ gear: 4, rpm: 5500, rpmMax: 8000 }), // shift
      frame({ gear: 4, rpm: 6000, rpmMax: 8000 })
    ]
    const s = summarizeGearing(frames)
    expect(s.shiftCount).toBe(1)
    expect(s.atRevLimitPct).toBe(0.25)
    expect(s.rpmByGear[3]).toBeCloseTo((4000 + 7900) / 2, 1)
    expect(s.rpmByGear[4]).toBeCloseTo((5500 + 6000) / 2, 1)
  })

  it('ignores gear=0 (reverse) transitions', () => {
    const frames = [
      frame({ gear: 2 }),
      frame({ gear: 0 }), // reverse — should not count as a shift
      frame({ gear: 2 })
    ]
    expect(summarizeGearing(frames).shiftCount).toBe(0)
  })

  it('treats FH6 mid-shift 11 (N) as a single shift, not two', () => {
    // FH6 streams 3 → 11 → 4 during an upshift. Naively comparing adjacent
    // frames would count two transitions; we want one.
    const frames = [
      frame({ gear: 3 }),
      frame({ gear: 3 }),
      frame({ gear: 11 }),
      frame({ gear: 11 }),
      frame({ gear: 4 }),
      frame({ gear: 4 })
    ]
    const s = summarizeGearing(frames)
    expect(s.shiftCount).toBe(1)
    // The neutral state should not pollute rpmByGear.
    expect(s.rpmByGear[11]).toBeUndefined()
  })

  it('does not count a clutch tap back to the same gear', () => {
    const frames = [
      frame({ gear: 3 }),
      frame({ gear: 11 }),
      frame({ gear: 3 })
    ]
    expect(summarizeGearing(frames).shiftCount).toBe(0)
  })
})

describe('summarizePower', () => {
  it('reports peak power in kW (raw frame is watts)', () => {
    const frames = [
      frame({ power: 200_000, torque: 300, rpm: 4000 }),
      frame({ power: 600_000, torque: 700, rpm: 6500 }), // peak power
      frame({ power: 400_000, torque: 500, rpm: 7500 })
    ]
    const s = summarizePower(frames)
    expect(s.peakPowerKw).toBe(600)
    expect(s.peakTorqueNm).toBe(700)
    expect(s.rpmAtPeakPower).toBe(6500)
  })

  it('returns zeros on empty input', () => {
    expect(summarizePower([])).toEqual({ peakPowerKw: 0, peakTorqueNm: 0, rpmAtPeakPower: 0 })
  })
})

describe('summarizeBoost', () => {
  it('returns peak across all frames and avg only under throttle > 0.5', () => {
    const frames = [
      frame({ throttle: 0.1, boost: 0.5 }), // not counted in avg
      frame({ throttle: 0.8, boost: 1.0 }),
      frame({ throttle: 0.8, boost: 2.0 }) // peak
    ]
    const s = summarizeBoost(frames)
    expect(s.peakBoost).toBe(2.0)
    expect(s.avgUnderThrottle).toBeCloseTo(1.5, 3)
  })

  it('avgUnderThrottle is 0 when no frame passes the throttle gate', () => {
    expect(summarizeBoost([frame({ throttle: 0.1, boost: 0.5 })]).avgUnderThrottle).toBe(0)
  })

  it('handles naturally-aspirated (boost = 0) cleanly', () => {
    const frames = Array.from({ length: 10 }, () => frame({ throttle: 0.9, boost: 0 }))
    const s = summarizeBoost(frames)
    expect(s.peakBoost).toBe(0)
    expect(s.avgUnderThrottle).toBe(0)
  })
})

describe('rumbleContactPct + summarizeLateralG + summarizeFrames', () => {
  it('rumbleContactPct counts any-wheel rumble frames', () => {
    const frames = [
      frame({ rumble: { fl: false, fr: false, rl: false, rr: false } }),
      frame({ rumble: { fl: true, fr: false, rl: false, rr: false } }),
      frame({ rumble: { fl: false, fr: false, rl: true, rr: true } })
    ]
    expect(rumbleContactPct(frames)).toBeCloseTo(2 / 3, 3)
  })

  it('summarizeLateralG produces a non-zero p95 for varied input', () => {
    const xs = Array.from({ length: 100 }, (_, i) =>
      frame({ acceleration: { x: 0, y: 0, z: i / 50 } }))
    const s = summarizeLateralG(xs)
    expect(s.p95).toBeGreaterThan(s.avg)
  })

  it('summarizeFrames wires every summarizer over the same input', () => {
    const xs = [
      frame({ throttle: 0.8, slipRatio: { fl: 0, fr: 0, rl: 0.2, rr: 0.2 }, brake: 0, gear: 3, speedKmh: 100 }),
      frame({ throttle: 0.0, brake: 0.4, gear: 3, speedKmh: 50 })
    ]
    const all = summarizeFrames(xs)
    expect(all.slipRatio.throttleFrames).toBe(1)
    expect(all.brake.brakingEvents).toBe(1)
    expect(all.gear.rpmByGear[3]).toBeDefined()
  })
})
