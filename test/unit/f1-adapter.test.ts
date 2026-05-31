import { describe, expect, it } from 'vitest'
import { createF1Adapter, f1Adapter } from '../../server/adapters/f1'

// Packed-struct sizes (must match the adapter).
const HEADER = 29
const SZ_TELEMETRY = 60
const SZ_MOTION = 60
const SZ_LAP = 57
const SZ_STATUS = 55
const SZ_MOTION_EX = 244

// Packet ids.
const ID_MOTION = 0
const ID_LAP = 2
const ID_CAR_TELEMETRY = 6
const ID_CAR_STATUS = 7
const ID_MOTION_EX = 13

const IDX = 2 // player car index — exercises array indexing

function withHeader(size: number, packetId: number, sessionTime = 0, format = 2025): Buffer {
  const buf = Buffer.alloc(size)
  buf.writeUInt16LE(format, 0)
  buf.writeUInt8(packetId, 6)
  buf.writeFloatLE(sessionTime, 15)
  buf.writeUInt8(IDX, 27)
  return buf
}

function telemetryPacket(): Buffer {
  const buf = withHeader(HEADER + 22 * SZ_TELEMETRY + 3, ID_CAR_TELEMETRY, 12.5)
  const b = HEADER + IDX * SZ_TELEMETRY
  buf.writeUInt16LE(210, b + 0) // speed km/h
  buf.writeFloatLE(0.75, b + 2) // throttle
  buf.writeFloatLE(-0.25, b + 6) // steer
  buf.writeFloatLE(0.10, b + 10) // brake
  buf.writeUInt8(50, b + 14) // clutch 0..100 → 0.5
  buf.writeInt8(5, b + 15) // gear
  buf.writeUInt16LE(11000, b + 16) // rpm
  // surface temps in F1 order RL, RR, FL, FR
  buf.writeUInt8(70, b + 30) // RL
  buf.writeUInt8(71, b + 31) // RR
  buf.writeUInt8(80, b + 32) // FL
  buf.writeUInt8(81, b + 33) // FR
  return buf
}

function statusPacket(): Buffer {
  const buf = withHeader(HEADER + 22 * SZ_STATUS, ID_CAR_STATUS)
  const b = HEADER + IDX * SZ_STATUS
  buf.writeFloatLE(50, b + 5) // fuelInTank
  buf.writeFloatLE(100, b + 9) // fuelCapacity → fuel 0.5
  buf.writeUInt16LE(13000, b + 17) // maxRPM
  buf.writeUInt16LE(4000, b + 19) // idleRPM
  buf.writeFloatLE(400000, b + 29) // engine_power_ice W
  buf.writeFloatLE(120000, b + 33) // engine_power_mguk W
  buf.writeUInt8(0, b + 54) // networkPaused
  return buf
}

function motionPacket(): Buffer {
  const buf = withHeader(HEADER + 22 * SZ_MOTION, ID_MOTION)
  const b = HEADER + IDX * SZ_MOTION
  buf.writeFloatLE(100, b + 0) // posX
  buf.writeFloatLE(5, b + 4) // posY
  buf.writeFloatLE(-250, b + 8) // posZ
  buf.writeFloatLE(60, b + 12) // velX
  buf.writeFloatLE(0, b + 16) // velY
  buf.writeFloatLE(2, b + 20) // velZ
  buf.writeFloatLE(1.0, b + 36) // gForceLateral
  buf.writeFloatLE(2.0, b + 40) // gForceLongitudinal
  buf.writeFloatLE(0.5, b + 44) // gForceVertical
  buf.writeFloatLE(0.1, b + 48) // yaw
  buf.writeFloatLE(-0.05, b + 52) // pitch
  buf.writeFloatLE(0.02, b + 56) // roll
  return buf
}

function motionExPacket(): Buffer {
  const buf = withHeader(HEADER + SZ_MOTION_EX, ID_MOTION_EX)
  const b = HEADER
  // slip ratio array RL,RR,FL,FR @ +64
  buf.writeFloatLE(0.01, b + 64) // RL
  buf.writeFloatLE(0.02, b + 68) // RR
  buf.writeFloatLE(0.03, b + 72) // FL
  buf.writeFloatLE(0.04, b + 76) // FR
  // slip angle array @ +80
  buf.writeFloatLE(0.0, b + 80)
  buf.writeFloatLE(0.0, b + 84)
  buf.writeFloatLE(0.0, b + 88)
  buf.writeFloatLE(0.0, b + 92)
  // angular velocity @ +144/148/152
  buf.writeFloatLE(0.3, b + 144)
  buf.writeFloatLE(0.6, b + 148)
  buf.writeFloatLE(0.9, b + 152)
  return buf
}

function lapPacket(lastMs: number, currentMs: number, lapNum: number): Buffer {
  const buf = withHeader(HEADER + 22 * SZ_LAP + 2, ID_LAP)
  const b = HEADER + IDX * SZ_LAP
  buf.writeUInt32LE(lastMs, b + 0)
  buf.writeUInt32LE(currentMs, b + 4)
  buf.writeFloatLE(1234.5, b + 24) // totalDistance
  buf.writeUInt8(3, b + 32) // carPosition
  buf.writeUInt8(lapNum, b + 33) // currentLapNum
  buf.writeUInt8(4, b + 44) // driverStatus = on track
  return buf
}

describe('f1 adapter', () => {
  it('binds to the f1 id and F1 UDP port', () => {
    expect(f1Adapter.id).toBe('f1')
    expect(f1Adapter.transport).toEqual({ protocol: 'udp', defaultPort: 20777 })
  })

  it('rejects undersized packets and unknown packet formats', () => {
    const a = createF1Adapter()
    expect(a.decode(Buffer.alloc(10))).toBeNull()
    const wrongFormat = telemetryPacket()
    wrongFormat.writeUInt16LE(2023, 0)
    expect(a.decode(wrongFormat)).toBeNull()
  })

  it('emits only on the Car Telemetry packet; folds the others into state', () => {
    const a = createF1Adapter()
    expect(a.decode(statusPacket())).toBeNull()
    expect(a.decode(motionPacket())).toBeNull()
    expect(a.decode(motionExPacket())).toBeNull()
    expect(a.decode(lapPacket(0, 5000, 1))).toBeNull()
    expect(a.decode(telemetryPacket())).not.toBeNull()
  })

  it('decodes Car Telemetry fields with F1 unit conventions', () => {
    const a = createF1Adapter()
    const t = a.decode(telemetryPacket())!
    expect(t.speedKmh).toBe(210) // already km/h
    expect(t.rpm).toBe(11000)
    expect(t.throttle).toBeCloseTo(0.75, 5)
    expect(t.brake).toBeCloseTo(0.10, 5)
    expect(t.steer).toBeCloseTo(-0.25, 5)
    expect(t.clutch).toBeCloseTo(0.5, 5) // 50/100
    expect(t.gear).toBe(5) // F1 encoding kept
  })

  it('reindexes F1 wheel order [RL,RR,FL,FR] → {fl,fr,rl,rr}', () => {
    const a = createF1Adapter()
    const t = a.decode(telemetryPacket())!
    expect(t.tireTempC).toEqual({ fl: 80, fr: 81, rl: 70, rr: 71 })
    a.decode(motionExPacket())
    const t2 = a.decode(telemetryPacket())!
    expect(t2.slipRatio.rl).toBeCloseTo(0.01, 5)
    expect(t2.slipRatio.rr).toBeCloseTo(0.02, 5)
    expect(t2.slipRatio.fl).toBeCloseTo(0.03, 5)
    expect(t2.slipRatio.fr).toBeCloseTo(0.04, 5)
  })

  it('has null torque/boost and sums ICE+MGU-K into power', () => {
    const a = createF1Adapter()
    a.decode(statusPacket())
    const t = a.decode(telemetryPacket())!
    expect(t.torque).toBeNull()
    expect(t.boost).toBeNull()
    expect(t.power).toBeCloseTo(520000, 0) // 400k ICE + 120k MGU-K
    expect(t.rpmMax).toBe(13000)
    expect(t.rpmIdle).toBe(4000)
    expect(t.fuel).toBeCloseTo(0.5, 5) // 50 / 100
  })

  it('merges Motion + Motion Ex + Lap state into the emitted frame', () => {
    const a = createF1Adapter()
    a.decode(motionPacket())
    a.decode(motionExPacket())
    a.decode(lapPacket(91000, 42100, 3))
    const t = a.decode(telemetryPacket())!
    expect(t.position).toEqual({ x: 100, y: 5, z: -250 })
    // accel approximated from g (x=lateral, y=vertical, z=longitudinal) × g
    expect(t.acceleration.x).toBeCloseTo(9.80665, 3)
    expect(t.acceleration.y).toBeCloseTo(0.5 * 9.80665, 3)
    expect(t.acceleration.z).toBeCloseTo(2 * 9.80665, 3)
    expect(t.angularVelocity.x).toBeCloseTo(0.3, 5)
    expect(t.angularVelocity.y).toBeCloseTo(0.6, 5)
    expect(t.angularVelocity.z).toBeCloseTo(0.9, 5)
    expect(t.lap.number).toBe(3)
    expect(t.lap.racePosition).toBe(3)
    expect(t.lap.current).toBeCloseTo(42.1, 3)
    expect(t.lap.last).toBeCloseTo(91.0, 3)
    expect(t.lap.distance).toBeCloseTo(1234.5, 3) // total (cumulative) distance
  })

  it('tracks best lap as the minimum completed lap time', () => {
    const a = createF1Adapter()
    a.decode(lapPacket(92000, 1000, 2))
    expect(a.decode(telemetryPacket())!.lap.best).toBeCloseTo(92.0, 3)
    a.decode(lapPacket(90500, 1000, 3))
    expect(a.decode(telemetryPacket())!.lap.best).toBeCloseTo(90.5, 3)
    a.decode(lapPacket(95000, 1000, 4)) // slower lap doesn't replace best
    expect(a.decode(telemetryPacket())!.lap.best).toBeCloseTo(90.5, 3)
  })

  it('derives isRaceOn from pause + driver status', () => {
    const a = createF1Adapter()
    // default driverStatus is "on track" → live before any Lap Data
    expect(a.decode(telemetryPacket())!.isRaceOn).toBe(true)
    // driverStatus 0 = in garage → not live
    const inGarage = lapPacket(0, 0, 0)
    inGarage.writeUInt8(0, HEADER + IDX * SZ_LAP + 44)
    a.decode(inGarage)
    expect(a.decode(telemetryPacket())!.isRaceOn).toBe(false)
  })

  it('keeps gear -1 for reverse', () => {
    const a = createF1Adapter()
    const p = telemetryPacket()
    p.writeInt8(-1, HEADER + IDX * SZ_TELEMETRY + 15)
    expect(a.decode(p)!.gear).toBe(-1)
  })
})
