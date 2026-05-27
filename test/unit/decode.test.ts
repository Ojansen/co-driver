import { describe, expect, it } from 'vitest'
import { HORIZON_CAR_DASH_BYTES, decodeHorizonCarDash } from '../../server/adapters/horizon-cardash'
import { fh5Adapter } from '../../server/adapters/fh5'
import { fh6Adapter } from '../../server/adapters/fh6'

function buildPacket(): Buffer {
  const buf = Buffer.alloc(HORIZON_CAR_DASH_BYTES)
  buf.writeInt32LE(1, 0) // isRaceOn
  buf.writeUInt32LE(123456, 4) // timestampMs
  buf.writeFloatLE(8000, 8) // rpmMax
  buf.writeFloatLE(900, 12) // rpmIdle
  buf.writeFloatLE(6400, 16) // current rpm

  buf.writeFloatLE(1.5, 20) // accel.x
  buf.writeFloatLE(-0.2, 24) // accel.y
  buf.writeFloatLE(3.3, 28) // accel.z

  // Yaw/pitch/roll at 56/60/64
  buf.writeFloatLE(0.1, 56)
  buf.writeFloatLE(-0.05, 60)
  buf.writeFloatLE(0.02, 64)

  // Suspension travel normalized (68..80), set bottoming-out on FL
  buf.writeFloatLE(0.97, 68)
  buf.writeFloatLE(0.42, 72)
  buf.writeFloatLE(0.30, 76)
  buf.writeFloatLE(0.31, 80)

  // Slip ratio (84..96)
  buf.writeFloatLE(0.12, 84)
  buf.writeFloatLE(-0.01, 88)
  buf.writeFloatLE(0.02, 92)
  buf.writeFloatLE(0.03, 96)

  // Rumble strip indicators (116..128) — set FR on
  buf.writeFloatLE(0, 116)
  buf.writeFloatLE(1, 120)
  buf.writeFloatLE(0, 124)
  buf.writeFloatLE(0, 128)

  // Slip angle (164..176)
  buf.writeFloatLE(0.05, 164)
  buf.writeFloatLE(0.07, 168)
  buf.writeFloatLE(0.20, 172)
  buf.writeFloatLE(0.21, 176)

  // Position (244..256)
  buf.writeFloatLE(100, 244)
  buf.writeFloatLE(5, 248)
  buf.writeFloatLE(-250, 252)

  // Speed m/s -> 40 m/s = 144 km/h
  buf.writeFloatLE(40, 256)
  buf.writeFloatLE(150000, 260) // power W
  buf.writeFloatLE(400, 264) // torque Nm

  // Tire temps °F (268..280) — 176 °F = 80 °C
  buf.writeFloatLE(176, 268)
  buf.writeFloatLE(176, 272)
  buf.writeFloatLE(176, 276)
  buf.writeFloatLE(176, 280)

  buf.writeFloatLE(0.8, 284) // boost
  buf.writeFloatLE(0.7, 288) // fuel

  buf.writeFloatLE(100.5, 292) // distance
  buf.writeFloatLE(85.123, 296) // best lap
  buf.writeFloatLE(86.5, 300) // last lap
  buf.writeFloatLE(42.1, 304) // current lap
  buf.writeFloatLE(200.0, 308) // race time

  buf.writeUInt16LE(3, 312) // lap number
  buf.writeUInt8(1, 314) // race position
  buf.writeUInt8(255, 315) // throttle (full)
  buf.writeUInt8(0, 316) // brake
  buf.writeUInt8(0, 317) // clutch
  buf.writeUInt8(0, 318) // handBrake
  buf.writeUInt8(5, 319) // gear (4th = u8 5 since 0=R, 1=N, 2=1st...)
  buf.writeInt8(64, 320) // steer right ~50%

  return buf
}

describe('decodeHorizonCarDash', () => {
  it('returns null for under-sized packets', () => {
    expect(decodeHorizonCarDash(Buffer.alloc(232))).toBeNull()
    expect(decodeHorizonCarDash(Buffer.alloc(100))).toBeNull()
  })

  it('decodes the basic race-state fields', () => {
    const t = decodeHorizonCarDash(buildPacket())!
    expect(t.isRaceOn).toBe(true)
    expect(t.timestampMs).toBe(123456)
    expect(t.rpm).toBe(6400)
    expect(t.rpmMax).toBe(8000)
    expect(t.rpmIdle).toBe(900)
  })

  it('converts m/s to km/h for speed', () => {
    const t = decodeHorizonCarDash(buildPacket())!
    expect(t.speedKmh).toBeCloseTo(144, 1) // 40 m/s
  })

  it('converts Fahrenheit tire temps to Celsius', () => {
    const t = decodeHorizonCarDash(buildPacket())!
    // 176 °F = 80 °C
    expect(t.tireTempC.fl).toBeCloseTo(80, 1)
    expect(t.tireTempC.fr).toBeCloseTo(80, 1)
    expect(t.tireTempC.rl).toBeCloseTo(80, 1)
    expect(t.tireTempC.rr).toBeCloseTo(80, 1)
  })

  it('decodes suspension travel and flags bottoming', () => {
    const t = decodeHorizonCarDash(buildPacket())!
    expect(t.suspension.fl).toBeCloseTo(0.97, 5)
    expect(t.suspension.fr).toBeCloseTo(0.42, 5)
    expect(t.suspension.fl > 0.95).toBe(true) // bottoming threshold
  })

  it('decodes wheel-on-rumble booleans', () => {
    const t = decodeHorizonCarDash(buildPacket())!
    expect(t.rumble.fl).toBe(false)
    expect(t.rumble.fr).toBe(true)
    expect(t.rumble.rl).toBe(false)
    expect(t.rumble.rr).toBe(false)
  })

  it('decodes inputs into 0..1 floats and steering into -1..1', () => {
    const t = decodeHorizonCarDash(buildPacket())!
    expect(t.throttle).toBe(1)
    expect(t.brake).toBe(0)
    expect(t.steer).toBeCloseTo(64 / 127, 4)
    expect(t.gear).toBe(5)
  })

  it('decodes lap state', () => {
    const t = decodeHorizonCarDash(buildPacket())!
    expect(t.lap.number).toBe(3)
    expect(t.lap.best).toBeCloseTo(85.123, 3)
    expect(t.lap.current).toBeCloseTo(42.1, 3)
  })

  it('still decodes when isRaceOn=0 — filtering is done by the caller', () => {
    const buf = buildPacket()
    buf.writeInt32LE(0, 0)
    const t = decodeHorizonCarDash(buf)
    expect(t).not.toBeNull()
    expect(t!.isRaceOn).toBe(false)
  })
})

describe('Horizon adapters', () => {
  it('FH5 and FH6 share the Horizon decoder and produce identical output', () => {
    const buf = buildPacket()
    const fromFh6 = fh6Adapter.decode(buf)
    const fromFh5 = fh5Adapter.decode(buf)
    expect(fromFh6).not.toBeNull()
    expect(fromFh5).toEqual(fromFh6)
  })

  it('both bind to the same id and UDP transport', () => {
    expect(fh6Adapter.id).toBe('fh6')
    expect(fh5Adapter.id).toBe('fh5')
    expect(fh5Adapter.transport).toEqual(fh6Adapter.transport)
  })
})
