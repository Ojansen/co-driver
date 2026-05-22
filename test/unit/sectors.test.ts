import { describe, expect, it } from 'vitest'
import { computeSectorTimes } from '../../app/utils/sectors'
import type { Telemetry } from '../../server/utils/decode'

function frame(distance: number, lapCurrent: number, timestampMs = 0): Telemetry {
  return {
    isRaceOn: true,
    timestampMs,
    rpm: 0, rpmMax: 0, rpmIdle: 0,
    speedKmh: 0, power: 0, torque: 0, boost: 0,
    gear: 3, throttle: 0, brake: 0, clutch: 0, handBrake: 0, steer: 0,
    drivingLine: 0, aiBrakeDifference: 0,
    suspension: { fl: 0, fr: 0, rl: 0, rr: 0 },
    suspensionMeters: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    tireTempC: { fl: 0, fr: 0, rl: 0, rr: 0 },
    wheelRotation: { fl: 0, fr: 0, rl: 0, rr: 0 },
    rumble: { fl: false, fr: false, rl: false, rr: false },
    puddle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    yaw: 0, pitch: 0, roll: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    car: { ordinal: 1, class: 5, pi: 800, drivetrain: 2, cylinders: 8 },
    lap: { number: 1, racePosition: 1, current: lapCurrent, last: 0, best: 0, raceTime: 0, distance },
    fuel: 1,
    rawLength: 324
  }
}

/** Build a synthetic lap of `length` meters over `seconds` seconds at 60 Hz. */
function makeLap(length: number, seconds: number): Telemetry[] {
  const HZ = 60
  const n = Math.max(2, Math.round(seconds * HZ))
  const out: Telemetry[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * seconds
    const d = (i / (n - 1)) * length
    // Anchor timestamps so last frame is exactly seconds * 1000 ms.
    out.push(frame(d, t, Math.round(t * 1000)))
  }
  return out
}

describe('computeSectorTimes', () => {
  it('splits an even 90 s / 4500 m lap into 3 equal 30 s sectors', () => {
    const lap = makeLap(4500, 90)
    const s = computeSectorTimes(lap)!
    expect(s).toHaveLength(3)
    expect(s[0]).toBeCloseTo(30000, -2) // within ~50 ms of 30 s
    expect(s[1]).toBeCloseTo(30000, -2)
    expect(s[2]).toBeCloseTo(30000, -2)
    expect(s[0]! + s[1]! + s[2]!).toBeCloseTo(90000, -2)
  })

  it('returns null for a single-frame lap', () => {
    expect(computeSectorTimes([frame(0, 0)])).toBeNull()
  })

  it('returns null when lap is too short (< sectorCount * 100 m)', () => {
    const lap = makeLap(150, 5) // 150 m lap, sectorCount=3 needs >= 300 m
    expect(computeSectorTimes(lap)).toBeNull()
  })

  it('falls back to timestampMs when lap.current is zero', () => {
    // makeLap leaves lap.current at 0 only on the first frame; force all to 0.
    const lap = makeLap(4500, 90).map(f => ({ ...f, lap: { ...f.lap, current: 0 } }))
    const s = computeSectorTimes(lap)!
    expect(s).toHaveLength(3)
    expect(s[0]! + s[1]! + s[2]!).toBeCloseTo(90000, -2)
  })

  it('respects a custom sectorCount', () => {
    const lap = makeLap(5000, 100)
    const s = computeSectorTimes(lap, 5)!
    expect(s).toHaveLength(5)
    for (const t of s) expect(t).toBeCloseTo(20000, -2)
  })

  it('normalizes when first frame distance is not zero', () => {
    const lap = makeLap(4500, 90).map(f => ({ ...f, lap: { ...f.lap, distance: f.lap.distance + 1234 } }))
    const s = computeSectorTimes(lap)!
    expect(s[0]).toBeCloseTo(30000, -2)
  })

  it('still produces 3 numbers when distance grows non-linearly', () => {
    // Front-loaded distance: car goes faster in sector 1 than 2/3.
    // Sector 1 should be shorter in time.
    const n = 60
    const seconds = 90
    const lap: Telemetry[] = []
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * seconds
      // distance(t) = lap_len * sqrt(t / total) → fast start, slow end
      const total = 4500
      const d = total * Math.sqrt(t / seconds)
      lap.push(frame(d, t, i * Math.round(1000 / 60)))
    }
    const s = computeSectorTimes(lap)!
    expect(s).toHaveLength(3)
    expect(s[0]).toBeLessThan(s[2]!) // sector 1 quicker than sector 3
  })
})
