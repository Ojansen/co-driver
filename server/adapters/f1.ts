/**
 * F1 (EA/Codemasters) adapter — F1 25 / F1 26 UDP telemetry.
 *
 * Unlike Forza's single self-contained packet, F1 spreads one logical frame
 * across several packet types (Motion, Lap Data, Car Telemetry, Car Status,
 * Motion Ex), each with its own `m_packetId` and rate. This adapter is therefore
 * STATEFUL: it accumulates the latest player-car fields from every relevant
 * packet and emits a merged `Telemetry` only on the Car Telemetry packet
 * (id 6, the natural per-frame trigger), returning `null` for the packets it is
 * just folding into state. The `TelemetryAdapter` contract is unchanged.
 *
 * Offsets below are derived from the F1 25 packed (`#pragma pack(1)`) structs;
 * the 2026 Season Pack reuses the same layout. See docs/f1-telemetry-mapping.md
 * for the full field-by-field diff, unit notes, and the open verification items
 * (suspension/wheel-speed units, isRaceOn heuristic).
 *
 * Wheel arrays in F1 are ordered [RL, RR, FL, FR]; our `Quad` is {fl,fr,rl,rr},
 * so every per-wheel read reindexes (see `quadF32`/`quadU8`).
 */

import type { Quad, Telemetry } from '../utils/decode'
import type { TelemetryAdapter } from './types'

const G = 9.80665 // g-force → m/s²

// Packet ids we consume (F1 25 spec).
const PID_MOTION = 0
const PID_LAP = 2
const PID_CAR_TELEMETRY = 6
const PID_CAR_STATUS = 7
const PID_MOTION_EX = 13

// Packed struct sizes (bytes).
const HEADER_BYTES = 29
const SZ_CAR_TELEMETRY = 60
const SZ_CAR_MOTION = 60
const SZ_LAP = 57
const SZ_CAR_STATUS = 55

// Only the formats whose byte layout matches the structs encoded here.
const SUPPORTED_FORMATS = new Set([2025, 2026])

interface F1State {
  sessionTime: number
  // engine / inputs (Car Telemetry)
  rpm: number
  speedKmh: number
  gear: number
  throttle: number
  brake: number
  clutch: number
  steer: number
  tireTempC: Quad
  // status (Car Status)
  rpmMax: number
  rpmIdle: number
  powerW: number
  fuelInTank: number
  fuelCapacity: number
  networkPaused: boolean
  // motion (Motion)
  position: { x: number, y: number, z: number }
  velocity: { x: number, y: number, z: number }
  acceleration: { x: number, y: number, z: number }
  yaw: number
  pitch: number
  roll: number
  // motion ex (Motion Ex)
  suspensionMeters: Quad
  slipRatio: Quad
  slipAngle: Quad
  wheelRotation: Quad
  angularVelocity: { x: number, y: number, z: number }
  // lap (Lap Data)
  lapNumber: number
  racePosition: number
  currentMs: number
  lastMs: number
  bestMs: number
  totalDistance: number
  driverStatus: number
}

const zeroQuad = (): Quad => ({ fl: 0, fr: 0, rl: 0, rr: 0 })

function initState(): F1State {
  return {
    sessionTime: 0,
    rpm: 0, speedKmh: 0, gear: 0, throttle: 0, brake: 0, clutch: 0, steer: 0,
    tireTempC: zeroQuad(),
    rpmMax: 0, rpmIdle: 0, powerW: 0, fuelInTank: 0, fuelCapacity: 0, networkPaused: false,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0, roll: 0,
    suspensionMeters: zeroQuad(),
    slipRatio: zeroQuad(),
    slipAngle: zeroQuad(),
    wheelRotation: zeroQuad(),
    angularVelocity: { x: 0, y: 0, z: 0 },
    lapNumber: 0, racePosition: 0, currentMs: 0, lastMs: 0, bestMs: 0,
    totalDistance: 0,
    // 4 = on track; default "live" so dashboards show immediately until Lap Data corrects it.
    driverStatus: 4
  }
}

/** Build a fresh, independently-stateful F1 adapter. The module exports a
 *  singleton (`f1Adapter`); tests use this for isolated instances. */
export function createF1Adapter(): TelemetryAdapter {
  const s = initState()

  function decode(buf: Buffer): Telemetry | null {
    if (buf.length < HEADER_BYTES) return null

    const format = buf.readUInt16LE(0)
    if (!SUPPORTED_FORMATS.has(format)) return null

    const packetId = buf.readUInt8(6)
    const playerIdx = buf.readUInt8(27)
    s.sessionTime = buf.readFloatLE(15)

    // Per-wheel readers that reindex F1's [RL,RR,FL,FR] → our {fl,fr,rl,rr}.
    const quadF32 = (base: number): Quad => ({
      fl: buf.readFloatLE(base + 8),
      fr: buf.readFloatLE(base + 12),
      rl: buf.readFloatLE(base + 0),
      rr: buf.readFloatLE(base + 4)
    })
    const quadU8 = (base: number): Quad => ({
      fl: buf.readUInt8(base + 2),
      fr: buf.readUInt8(base + 3),
      rl: buf.readUInt8(base + 0),
      rr: buf.readUInt8(base + 1)
    })

    switch (packetId) {
      case PID_CAR_TELEMETRY: {
        const base = HEADER_BYTES + playerIdx * SZ_CAR_TELEMETRY
        if (buf.length < base + SZ_CAR_TELEMETRY) return null
        s.speedKmh = buf.readUInt16LE(base + 0)
        s.throttle = buf.readFloatLE(base + 2)
        s.steer = buf.readFloatLE(base + 6)
        s.brake = buf.readFloatLE(base + 10)
        s.clutch = buf.readUInt8(base + 14) / 100
        s.gear = buf.readInt8(base + 15) // F1 encoding: -1=R, 0=N, 1..8
        s.rpm = buf.readUInt16LE(base + 16)
        s.tireTempC = quadU8(base + 30) // surface temperature, already °C
        return build(s, buf.length) // Car Telemetry is the per-frame emit trigger.
      }
      case PID_MOTION: {
        const base = HEADER_BYTES + playerIdx * SZ_CAR_MOTION
        if (buf.length < base + SZ_CAR_MOTION) return null
        s.position = { x: buf.readFloatLE(base + 0), y: buf.readFloatLE(base + 4), z: buf.readFloatLE(base + 8) }
        s.velocity = { x: buf.readFloatLE(base + 12), y: buf.readFloatLE(base + 16), z: buf.readFloatLE(base + 20) }
        // F1 gives only g-force components; approximate linear accel (x=lateral, y=vertical, z=longitudinal).
        s.acceleration = {
          x: buf.readFloatLE(base + 36) * G,
          y: buf.readFloatLE(base + 44) * G,
          z: buf.readFloatLE(base + 40) * G
        }
        s.yaw = buf.readFloatLE(base + 48)
        s.pitch = buf.readFloatLE(base + 52)
        s.roll = buf.readFloatLE(base + 56)
        return null
      }
      case PID_MOTION_EX: {
        // Player car only; struct begins right after the header.
        const base = HEADER_BYTES
        if (buf.length < base + 156) return null // through angularVelocity (offsets 144..152)
        s.suspensionMeters = quadF32(base + 0) // units unverified (raw position)
        s.wheelRotation = quadF32(base + 48) // F1 "wheel speed"; units unverified
        s.slipRatio = quadF32(base + 64)
        s.slipAngle = quadF32(base + 80)
        s.angularVelocity = {
          x: buf.readFloatLE(base + 144),
          y: buf.readFloatLE(base + 148),
          z: buf.readFloatLE(base + 152)
        }
        return null
      }
      case PID_CAR_STATUS: {
        const base = HEADER_BYTES + playerIdx * SZ_CAR_STATUS
        if (buf.length < base + SZ_CAR_STATUS) return null
        s.fuelInTank = buf.readFloatLE(base + 5)
        s.fuelCapacity = buf.readFloatLE(base + 9)
        s.rpmMax = buf.readUInt16LE(base + 17)
        s.rpmIdle = buf.readUInt16LE(base + 19)
        // F1 25 exposes ICE + MGU-K power (assumed Watts, to match Forza's W).
        s.powerW = buf.readFloatLE(base + 29) + buf.readFloatLE(base + 33)
        s.networkPaused = buf.readUInt8(base + 54) !== 0
        return null
      }
      case PID_LAP: {
        const base = HEADER_BYTES + playerIdx * SZ_LAP
        if (buf.length < base + SZ_LAP) return null
        s.lastMs = buf.readUInt32LE(base + 0)
        s.currentMs = buf.readUInt32LE(base + 4)
        // m_totalDistance (cumulative race distance) matches FH6's lap.distance semantic.
        s.totalDistance = buf.readFloatLE(base + 24)
        s.racePosition = buf.readUInt8(base + 32)
        s.lapNumber = buf.readUInt8(base + 33)
        s.driverStatus = buf.readUInt8(base + 44)
        // Best lap isn't in Lap Data (it's in Session History); track the min completed lap.
        if (s.lastMs > 0 && (s.bestMs === 0 || s.lastMs < s.bestMs)) s.bestMs = s.lastMs
        return null
      }
      default:
        return null
    }
  }

  return {
    id: 'f1',
    transport: { protocol: 'udp', defaultPort: 20777 },
    decode
  }
}

function build(s: F1State, rawLength: number): Telemetry {
  const combined = (r: Quad, a: Quad): Quad => ({
    fl: Math.hypot(r.fl, a.fl),
    fr: Math.hypot(r.fr, a.fr),
    rl: Math.hypot(r.rl, a.rl),
    rr: Math.hypot(r.rr, a.rr)
  })

  return {
    // No direct "race on" bit; treat as live unless paused or in garage.
    isRaceOn: !s.networkPaused && s.driverStatus !== 0,
    timestampMs: s.sessionTime * 1000,

    rpm: s.rpm,
    rpmMax: s.rpmMax,
    rpmIdle: s.rpmIdle,

    speedKmh: s.speedKmh,
    power: s.powerW,
    torque: null, // no F1 channel
    boost: null, // no F1 turbo-boost gauge

    gear: s.gear,
    throttle: s.throttle,
    brake: s.brake,
    clutch: s.clutch,
    handBrake: 0, // no F1 channel
    steer: s.steer,
    drivingLine: null,
    aiBrakeDifference: null,

    suspension: zeroQuad(), // no normalized-travel channel
    suspensionMeters: s.suspensionMeters,
    slipRatio: s.slipRatio,
    slipAngle: s.slipAngle,
    combinedSlip: combined(s.slipRatio, s.slipAngle),
    tireTempC: s.tireTempC,
    wheelRotation: s.wheelRotation,
    rumble: null,
    puddle: null,

    yaw: s.yaw,
    pitch: s.pitch,
    roll: s.roll,

    position: s.position,
    velocity: s.velocity,
    acceleration: s.acceleration,
    angularVelocity: s.angularVelocity,

    car: {
      // F1 has no Performance Index / car ordinal; drivetrain + cylinders are
      // constant for the modern F1 field (RWD, V6 turbo-hybrid).
      ordinal: 0,
      class: 0,
      pi: 0,
      drivetrain: 1,
      cylinders: 6
    },

    lap: {
      number: s.lapNumber,
      racePosition: s.racePosition,
      current: s.currentMs / 1000,
      last: s.lastMs / 1000,
      best: s.bestMs / 1000,
      raceTime: s.sessionTime,
      distance: s.totalDistance
    },

    fuel: s.fuelCapacity > 0 ? Math.min(1, Math.max(0, s.fuelInTank / s.fuelCapacity)) : null,
    rawLength
  }
}

export const f1Adapter = createF1Adapter()
