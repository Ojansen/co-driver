import { describe, expect, it } from 'vitest'
import {
  HORIZON_CAR_DASH_BYTES,
  MOTORSPORT_CAR_DASH_BYTES,
  decodeForzaDataOut,
  decodeHorizonCarDash,
  decodeMotorsportCarDash
} from '../../server/adapters/horizon-cardash'
import { fmAdapter } from '../../server/adapters/fm'

// Motorsport Dash: shared Sled (0..231) + Dash contiguous at offset 232
// (Horizon's 244 − 12). FM7 = 311 bytes; FM 2023 = 331 (trailing fields ignored).
function buildMotorsportPacket(len = MOTORSPORT_CAR_DASH_BYTES): Buffer {
  const buf = Buffer.alloc(len)
  const d = 232 // dash base

  // Sled (fixed offsets)
  buf.writeInt32LE(1, 0) // isRaceOn
  buf.writeUInt32LE(123456, 4) // timestampMs
  buf.writeFloatLE(8000, 8) // rpmMax
  buf.writeFloatLE(900, 12) // rpmIdle
  buf.writeFloatLE(6400, 16) // rpm
  buf.writeInt32LE(2722, 212) // car ordinal
  buf.writeInt32LE(5, 216) // car class

  // Dash (offset 232)
  buf.writeFloatLE(10, d) // position.x
  buf.writeFloatLE(20, d + 4) // position.y
  buf.writeFloatLE(30, d + 8) // position.z
  buf.writeFloatLE(50, d + 12) // speed m/s -> 180 km/h
  buf.writeFloatLE(150000, d + 16) // power
  buf.writeFloatLE(400, d + 20) // torque
  buf.writeFloatLE(176, d + 24) // tire temp °F -> 80 °C (fl)
  buf.writeFloatLE(176, d + 28)
  buf.writeFloatLE(176, d + 32)
  buf.writeFloatLE(176, d + 36)
  buf.writeFloatLE(0.5, d + 40) // boost
  buf.writeFloatLE(0.7, d + 44) // fuel
  buf.writeFloatLE(1234.5, d + 48) // lap distance
  buf.writeFloatLE(85.1, d + 52) // best
  buf.writeFloatLE(86.2, d + 56) // last
  buf.writeFloatLE(42.3, d + 60) // current
  buf.writeFloatLE(200, d + 64) // raceTime
  buf.writeUInt16LE(3, d + 68) // lap number
  buf.writeUInt8(2, d + 70) // race position
  buf.writeUInt8(255, d + 71) // throttle
  buf.writeUInt8(0, d + 72) // brake
  buf.writeUInt8(0, d + 73) // clutch
  buf.writeUInt8(0, d + 74) // handBrake
  buf.writeUInt8(4, d + 75) // gear
  buf.writeInt8(64, d + 76) // steer
  return buf
}

describe('decodeMotorsportCarDash', () => {
  it('returns null for Sled-only / undersized packets', () => {
    expect(decodeMotorsportCarDash(Buffer.alloc(232))).toBeNull()
    expect(decodeMotorsportCarDash(Buffer.alloc(100))).toBeNull()
  })

  it('decodes Dash fields at the contiguous (offset 232) layout', () => {
    const t = decodeMotorsportCarDash(buildMotorsportPacket())!
    expect(t.isRaceOn).toBe(true)
    expect(t.rpm).toBe(6400)
    expect(t.speedKmh).toBeCloseTo(180, 1) // 50 m/s
    expect(t.power).toBeCloseTo(150000, 0)
    expect(t.tireTempC.fl).toBeCloseTo(80, 1) // 176 °F
    expect(t.car.ordinal).toBe(2722)
    expect(t.lap.number).toBe(3)
    expect(t.lap.current).toBeCloseTo(42.3, 3)
    expect(t.throttle).toBe(1)
    expect(t.gear).toBe(4)
    expect(t.steer).toBeCloseTo(64 / 127, 4)
    expect(t.rawLength).toBe(311)
  })

  it('decodes the FM 2023 length (331), ignoring trailing fields', () => {
    const t = decodeMotorsportCarDash(buildMotorsportPacket(331))!
    expect(t.speedKmh).toBeCloseTo(180, 1)
    expect(t.lap.number).toBe(3)
    expect(t.rawLength).toBe(331)
  })
})

describe('decodeForzaDataOut dispatcher', () => {
  it('routes 324-byte packets to the Horizon layout', () => {
    const buf = Buffer.alloc(HORIZON_CAR_DASH_BYTES)
    buf.writeInt32LE(1, 0)
    expect(decodeForzaDataOut(buf)).toEqual(decodeHorizonCarDash(buf))
  })

  it('routes 311- and 331-byte packets to the Motorsport layout', () => {
    const fm7 = buildMotorsportPacket(311)
    const fm23 = buildMotorsportPacket(331)
    expect(decodeForzaDataOut(fm7)).toEqual(decodeMotorsportCarDash(fm7))
    expect(decodeForzaDataOut(fm23)).toEqual(decodeMotorsportCarDash(fm23))
  })

  it('rejects packets shorter than a Motorsport Dash', () => {
    expect(decodeForzaDataOut(Buffer.alloc(232))).toBeNull()
  })
})

describe('fm adapter', () => {
  it('binds to the fm id and the shared Forza Data Out port', () => {
    expect(fmAdapter.id).toBe('fm')
    expect(fmAdapter.transport).toEqual({ protocol: 'udp', defaultPort: 5300 })
  })

  it('decodes a Motorsport Dash packet', () => {
    const t = fmAdapter.decode(buildMotorsportPacket())!
    expect(t).not.toBeNull()
    expect(t.speedKmh).toBeCloseTo(180, 1)
  })
})
