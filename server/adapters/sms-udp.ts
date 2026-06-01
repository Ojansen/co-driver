/**
 * SMS UDP adapter — Madness-engine "Project CARS 2" telemetry protocol.
 *
 * Used by Project CARS 2 and (in PCARS2-compatible mode) Automobilista 2. Like
 * F1, one logical frame is spread across packet types, each with a 12-byte
 * PacketBase header; the dispatch key is `mPacketType` (u8 @10). This adapter is
 * STATEFUL: it folds the latest Timings (lap number/position/current/distance),
 * TimeStats (last/best lap) and GameState (isRaceOn) into state and emits a
 * merged `Telemetry` on the Car Physics packet (type 0), keyed to the viewed
 * participant (`sViewedParticipantIndex`).
 *
 * Offsets are from SMS_UDP_Definitions.hpp (#pragma pack(1)). Wheel arrays are
 * [FL,FR,RL,RR] — exactly our Quad order, no reindex. See
 * docs/sms-udp-telemetry-mapping.md for the full diff, derivations and the
 * open verification items (boost/engine-speed/tyre-RPS units, orientation order).
 */

import type { GameId } from '#shared/games'
import type { Quad, Telemetry } from '../utils/decode'
import type { TelemetryAdapter } from './types'

const TWO_PI = Math.PI * 2

// PacketBase
const TYPE_OFFSET = 10
// Packet types (EUDPStreamerPacketHandlerType)
const PT_CAR_PHYSICS = 0
const PT_TIMINGS = 3
const PT_GAME_STATE = 4
const PT_TIME_STATS = 7

// Packed struct sizes (bytes)
const SZ_TELEMETRY = 556
const SZ_TIMINGS = 1059
const SZ_TIME_STATS = 1040
const SZ_GAME_STATE = 24

// Per-participant array layouts
const TIMINGS_PARTICIPANTS_OFFSET = 33
const PARTICIPANT_INFO_SIZE = 32
const TIMESTATS_STATS_OFFSET = 16
const STATS_INFO_SIZE = 32
const MAX_PARTICIPANTS = 32

const GAME_STATE_PLAYING = 2 // EUDPGameState: GAME_INGAME_PLAYING

interface SmsState {
  // physics (set on Car Physics packet)
  rpm: number
  rpmMax: number
  speedKmh: number
  power: number
  torque: number
  boost: number
  gear: number
  throttle: number
  brake: number
  clutch: number
  handBrake: number
  steer: number
  fuel: number
  tireTempC: Quad
  wheelRotation: Quad
  suspensionMeters: Quad
  yaw: number
  pitch: number
  roll: number
  position: { x: number, y: number, z: number }
  velocity: { x: number, y: number, z: number }
  acceleration: { x: number, y: number, z: number }
  angularVelocity: { x: number, y: number, z: number }
  rawLength: number
  viewedIndex: number
  // folded from other packets
  timingsBuf: Buffer | null
  timeStatsBuf: Buffer | null
  playing: boolean
}

const zeroQuad = (): Quad => ({ fl: 0, fr: 0, rl: 0, rr: 0 })
const zeroVec = (): { x: number, y: number, z: number } => ({ x: 0, y: 0, z: 0 })

function initState(): SmsState {
  return {
    rpm: 0, rpmMax: 0, speedKmh: 0, power: 0, torque: 0, boost: 0,
    gear: 0, throttle: 0, brake: 0, clutch: 0, handBrake: 0, steer: 0, fuel: 0,
    tireTempC: zeroQuad(), wheelRotation: zeroQuad(), suspensionMeters: zeroQuad(),
    yaw: 0, pitch: 0, roll: 0,
    position: zeroVec(), velocity: zeroVec(), acceleration: zeroVec(), angularVelocity: zeroVec(),
    rawLength: 0,
    viewedIndex: 0,
    timingsBuf: null,
    timeStatsBuf: null,
    playing: true
  }
}

/** Build a fresh, independently-stateful SMS UDP adapter. `id` lets Automobilista
 *  2 (in "Project CARS 2" UDP mode) reuse this decoder under its own game id; the
 *  module also exports a `pcars2` singleton. Tests use this for isolated instances. */
export function createSmsUdpAdapter(id: GameId = 'pcars2'): TelemetryAdapter {
  const s = initState()

  function decode(buf: Buffer): Telemetry | null {
    if (buf.length < 12) return null
    const type = buf.readUInt8(TYPE_OFFSET)

    switch (type) {
      case PT_CAR_PHYSICS: {
        if (buf.length < SZ_TELEMETRY) return null
        const f32 = (o: number): number => buf.readFloatLE(o)
        const u8 = (o: number): number => buf.readUInt8(o)
        const quadF32 = (b: number): Quad => ({ fl: f32(b), fr: f32(b + 4), rl: f32(b + 8), rr: f32(b + 12) })

        s.viewedIndex = buf.readInt8(12)
        s.throttle = u8(30) / 255
        s.brake = u8(29) / 255
        s.clutch = u8(31) / 255
        s.handBrake = u8(370) / 255
        s.steer = buf.readInt8(44) / 127
        const g = u8(45) & 0x0f
        s.gear = g === 15 ? -1 : g // 15 = reverse, 0 = neutral
        s.rpm = buf.readUInt16LE(40)
        s.rpmMax = buf.readUInt16LE(42)
        s.speedKmh = f32(36) * 3.6
        s.torque = f32(364)
        s.power = s.torque * f32(360) // P = torque × engineSpeed(rad/s) → W
        s.boost = f32(538)
        s.fuel = f32(32)
        s.tireTempC = { fl: u8(176), fr: u8(177), rl: u8(178), rr: u8(179) }
        const rps = quadF32(160)
        s.wheelRotation = { fl: rps.fl * TWO_PI, fr: rps.fr * TWO_PI, rl: rps.rl * TWO_PI, rr: rps.rr * TWO_PI }
        s.suspensionMeters = quadF32(312)
        s.yaw = f32(52)
        s.pitch = f32(56)
        s.roll = f32(60)
        s.position = { x: f32(542), y: f32(546), z: f32(550) }
        s.velocity = { x: f32(76), y: f32(80), z: f32(84) }
        s.acceleration = { x: f32(100), y: f32(104), z: f32(108) }
        s.angularVelocity = { x: f32(88), y: f32(92), z: f32(96) }
        s.rawLength = buf.length
        return build(s)
      }
      case PT_TIMINGS: {
        if (buf.length >= SZ_TIMINGS) s.timingsBuf = buf
        return null
      }
      case PT_TIME_STATS: {
        if (buf.length >= SZ_TIME_STATS) s.timeStatsBuf = buf
        return null
      }
      case PT_GAME_STATE: {
        if (buf.length >= SZ_GAME_STATE) s.playing = (buf.readUInt8(14) & 0x07) === GAME_STATE_PLAYING
        return null
      }
      default:
        return null
    }
  }

  return {
    id,
    transport: { protocol: 'udp', defaultPort: 5606 },
    decode
  }
}

interface LapInfo {
  number: number
  racePosition: number
  current: number
  last: number
  best: number
  distance: number
}

function readLap(s: SmsState): LapInfo {
  const lap: LapInfo = { number: 0, racePosition: 0, current: 0, last: 0, best: 0, distance: 0 }
  const idx = s.viewedIndex
  if (idx < 0 || idx >= MAX_PARTICIPANTS) return lap

  const t = s.timingsBuf
  const base = TIMINGS_PARTICIPANTS_OFFSET + idx * PARTICIPANT_INFO_SIZE
  if (t && t.length >= base + PARTICIPANT_INFO_SIZE) {
    lap.distance = t.readUInt16LE(base + 12)
    lap.racePosition = t.readUInt8(base + 14) & 0x7f // top bit = active flag
    lap.number = t.readUInt8(base + 21)
    lap.current = t.readFloatLE(base + 22)
  }

  const ts = s.timeStatsBuf
  const sbase = TIMESTATS_STATS_OFFSET + idx * STATS_INFO_SIZE
  if (ts && ts.length >= sbase + 8) {
    lap.best = ts.readFloatLE(sbase + 0)
    lap.last = ts.readFloatLE(sbase + 4)
  }
  return lap
}

function build(s: SmsState): Telemetry {
  const lap = readLap(s)
  return {
    isRaceOn: s.playing,
    timestampMs: Date.now(), // SMS UDP carries no game clock — wall-clock ms (live-only)

    rpm: s.rpm,
    rpmMax: s.rpmMax,
    rpmIdle: 0, // no SMS field

    speedKmh: s.speedKmh,
    power: s.power,
    torque: s.torque,
    boost: s.boost,

    gear: s.gear,
    throttle: s.throttle,
    brake: s.brake,
    clutch: s.clutch,
    handBrake: s.handBrake,
    steer: s.steer,
    drivingLine: null,
    aiBrakeDifference: null,

    suspension: zeroQuad(), // no normalized-travel channel
    suspensionMeters: s.suspensionMeters,
    slipRatio: zeroQuad(), // SMS UDP telemetry has no slip channels
    slipAngle: zeroQuad(),
    combinedSlip: zeroQuad(),
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

    car: { ordinal: 0, class: 0, pi: 0, drivetrain: 0, cylinders: 0 }, // names are strings in another packet

    lap: {
      number: lap.number,
      racePosition: lap.racePosition,
      current: lap.current,
      last: lap.last,
      best: lap.best,
      raceTime: 0, // no elapsed-time field
      distance: lap.distance // per-lap metres (SMS resets each lap; FH6 is cumulative)
    },

    fuel: s.fuel,
    rawLength: s.rawLength
  }
}

export const smsUdpAdapter = createSmsUdpAdapter()
