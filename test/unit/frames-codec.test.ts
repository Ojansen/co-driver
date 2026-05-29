import { describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { encodeFrames, decodeFrames } from '../../server/utils/frames-codec'
import type { Telemetry, Quad } from '../../server/utils/decode'

/** A fully-populated frame with deliberately non-f32-round f64 values, so the
 *  test actually exercises f32 quantization (not values that happen to survive
 *  unchanged). `opts.nulls` blanks every nullable field; `opts.partial` blanks
 *  only some, to prove the per-column presence bitsets don't cross-talk. */
function frame(i: number, opts: { nulls?: boolean, partial?: boolean } = {}): Telemetry {
  const q = (b: number): Quad => ({ fl: b, fr: b + 0.137, rl: b + 0.291, rr: b + 0.413 })
  const f: Telemetry = {
    isRaceOn: i % 2 === 0,
    timestampMs: i * (1000 / 60), // f64, must round-trip exactly
    rpm: 6000.123 + i, rpmMax: 8000, rpmIdle: 900,
    speedKmh: 140.256, power: 120000.5, torque: 320.77, boost: 0.83,
    gear: 4, throttle: 0.817, brake: 0.119, clutch: 0, handBrake: 0, steer: -0.137,
    drivingLine: 5, aiBrakeDifference: -3,
    suspension: q(0.5), suspensionMeters: q(0.05317), slipRatio: q(0.0531), slipAngle: q(0.113), combinedSlip: q(0.117), tireTempC: q(85.37),
    wheelRotation: q(120.73),
    rumble: { fl: true, fr: false, rl: true, rr: false },
    puddle: q(0.013),
    yaw: 0.1237, pitch: 0.0113, roll: 0.0227,
    position: { x: 100.53 + i, y: 5.27, z: 200.71 + i },
    velocity: { x: 38.19, y: 0, z: 1.23 },
    acceleration: { x: 2.37, y: 0.13, z: 9.81 },
    angularVelocity: { x: 0, y: 0.27, z: 0 },
    car: { ordinal: 1234, class: 5, pi: 800, drivetrain: 2, cylinders: 8 },
    lap: { number: 1, racePosition: 1, current: i * 0.0166, last: 0, best: 0, raceTime: i * 0.0166, distance: i * 0.6 },
    fuel: 0.953, rawLength: 324
  }
  if (opts.nulls) {
    f.drivingLine = null
    f.aiBrakeDifference = null
    f.wheelRotation = null
    f.rumble = null
    f.puddle = null
    f.fuel = null
  }
  if (opts.partial) {
    // only some nullable fields blanked — others stay present
    f.wheelRotation = null
    f.fuel = null
  }
  return f
}

/** Project a frame through f32 to get the expected post-round-trip value:
 *  timestampMs stays exact (f64), every other numeric is `Math.fround`ed,
 *  null/boolean structure preserved. */
function projectF32(f: Telemetry): Telemetry {
  const F = Math.fround
  const q = (x: Quad | null) => x == null ? null : { fl: F(x.fl), fr: F(x.fr), rl: F(x.rl), rr: F(x.rr) }
  const v3 = (o: { x: number, y: number, z: number }) => ({ x: F(o.x), y: F(o.y), z: F(o.z) })
  return {
    isRaceOn: f.isRaceOn,
    timestampMs: f.timestampMs,
    rpm: F(f.rpm), rpmMax: F(f.rpmMax), rpmIdle: F(f.rpmIdle),
    speedKmh: F(f.speedKmh), power: F(f.power), torque: F(f.torque), boost: F(f.boost),
    gear: F(f.gear), throttle: F(f.throttle), brake: F(f.brake), clutch: F(f.clutch), handBrake: F(f.handBrake), steer: F(f.steer),
    drivingLine: f.drivingLine == null ? null : F(f.drivingLine),
    aiBrakeDifference: f.aiBrakeDifference == null ? null : F(f.aiBrakeDifference),
    suspension: q(f.suspension)!, suspensionMeters: q(f.suspensionMeters)!, slipRatio: q(f.slipRatio)!, slipAngle: q(f.slipAngle)!, combinedSlip: q(f.combinedSlip)!, tireTempC: q(f.tireTempC)!,
    wheelRotation: q(f.wheelRotation),
    rumble: f.rumble == null ? null : { ...f.rumble },
    puddle: q(f.puddle),
    yaw: F(f.yaw), pitch: F(f.pitch), roll: F(f.roll),
    position: v3(f.position), velocity: v3(f.velocity), acceleration: v3(f.acceleration), angularVelocity: v3(f.angularVelocity),
    car: { ordinal: F(f.car.ordinal), class: F(f.car.class), pi: F(f.car.pi), drivetrain: F(f.car.drivetrain), cylinders: F(f.car.cylinders) },
    lap: { number: F(f.lap.number), racePosition: F(f.lap.racePosition), current: F(f.lap.current), last: F(f.lap.last), best: F(f.lap.best), raceTime: F(f.lap.raceTime), distance: F(f.lap.distance) },
    fuel: f.fuel == null ? null : F(f.fuel),
    rawLength: F(f.rawLength)
  }
}

describe('frames-codec', () => {
  it('round-trips a full frame to f32 precision (timestamp exact)', () => {
    const frames = Array.from({ length: 200 }, (_, i) => frame(i))
    const got = decodeFrames(encodeFrames(frames))
    expect(got).toEqual(frames.map(projectF32))
  })

  it('preserves null on every nullable field', () => {
    const frames = [frame(0), frame(1, { nulls: true }), frame(2)]
    const got = decodeFrames(encodeFrames(frames))
    expect(got[1]!.drivingLine).toBeNull()
    expect(got[1]!.aiBrakeDifference).toBeNull()
    expect(got[1]!.wheelRotation).toBeNull()
    expect(got[1]!.rumble).toBeNull()
    expect(got[1]!.puddle).toBeNull()
    expect(got[1]!.fuel).toBeNull()
    expect(got).toEqual(frames.map(projectF32))
  })

  it('keeps per-column presence independent (partial nulls do not cross-talk)', () => {
    const frames = [frame(0, { partial: true }), frame(1), frame(2, { nulls: true })]
    const got = decodeFrames(encodeFrames(frames))
    // frame 0: only wheelRotation + fuel null, the rest present
    expect(got[0]!.wheelRotation).toBeNull()
    expect(got[0]!.fuel).toBeNull()
    expect(got[0]!.puddle).not.toBeNull()
    expect(got[0]!.rumble).not.toBeNull()
    expect(got[0]!.drivingLine).not.toBeNull()
    expect(got).toEqual(frames.map(projectF32))
  })

  it('reads legacy gzipped-JSON blobs unchanged (format sniff)', () => {
    const frames = [frame(0), frame(1, { nulls: true }), frame(2, { partial: true })]
    const legacy = gzipSync(Buffer.from(JSON.stringify(frames), 'utf8'))
    // legacy decode is exact (JSON preserves f64), no f32 projection
    expect(decodeFrames(legacy)).toEqual(frames)
  })

  it('new blobs carry the FZC1 magic, not the gzip magic', () => {
    const blob = encodeFrames([frame(0)])
    expect(blob.subarray(0, 4).toString('ascii')).toBe('FZC1')
    expect(blob[0]).not.toBe(0x1f)
  })

  it('round-trips an empty lap', () => {
    expect(decodeFrames(encodeFrames([]))).toEqual([])
  })

  it('throws on an unrecognized blob', () => {
    expect(() => decodeFrames(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toThrow(/unrecognized/)
  })

  it('new blob is smaller than the legacy gzipped JSON', () => {
    const frames = Array.from({ length: 3600 }, (_, i) => frame(i))
    const legacy = gzipSync(Buffer.from(JSON.stringify(frames), 'utf8'))
    expect(encodeFrames(frames).length).toBeLessThan(legacy.length)
  })
})
