/**
 * Forza Horizon "Data Out" Car Dash decoder — shared by every Horizon title.
 *
 * FH4, FH5 and FH6 all emit the same 324-byte, little-endian Horizon variant:
 * a Sled portion (offsets 0..231), a 12-byte gap, then the Dash extension
 * (offsets 244..323). Because the wire format is identical across these games,
 * a single decoder backs all of their adapters — each adapter is just an id +
 * transport wrapper around this function.
 *
 * Motorsport's Dash is contiguous (no 12-byte gap); an FM adapter branches on
 * buf.length and offsets the Dash reads by -12 rather than reusing this.
 *
 * Field offsets and types are documented in DESIGN.md §2.
 */

import type { Quad, Telemetry } from '../utils/decode'

export const HORIZON_CAR_DASH_BYTES = 324

const fToC = (f: number): number => (f - 32) * 5 / 9
const msToKmh = (ms: number): number => ms * 3.6

export function decodeHorizonCarDash(buf: Buffer): Telemetry | null {
  // Accept short Sled-only packets gracefully (return null so we can log).
  if (buf.length < HORIZON_CAR_DASH_BYTES) return null

  const f32 = (o: number): number => buf.readFloatLE(o)
  const u8 = (o: number): number => buf.readUInt8(o)
  const s8 = (o: number): number => buf.readInt8(o)
  const s32 = (o: number): number => buf.readInt32LE(o)
  const u16 = (o: number): number => buf.readUInt16LE(o)
  const u32 = (o: number): number => buf.readUInt32LE(o)

  const quad = (o: number): Quad => ({
    fl: f32(o),
    fr: f32(o + 4),
    rl: f32(o + 8),
    rr: f32(o + 12)
  })

  return {
    isRaceOn: s32(0) === 1,
    timestampMs: u32(4),

    rpmMax: f32(8),
    rpmIdle: f32(12),
    rpm: f32(16),

    acceleration: { x: f32(20), y: f32(24), z: f32(28) },
    velocity: { x: f32(32), y: f32(36), z: f32(40) },
    angularVelocity: { x: f32(44), y: f32(48), z: f32(52) },

    yaw: f32(56),
    pitch: f32(60),
    roll: f32(64),

    suspension: quad(68),
    slipRatio: quad(84),
    wheelRotation: quad(100),
    rumble: {
      fl: f32(116) > 0,
      fr: f32(120) > 0,
      rl: f32(124) > 0,
      rr: f32(128) > 0
    },
    puddle: quad(132),
    slipAngle: quad(164),
    combinedSlip: quad(180),
    suspensionMeters: quad(196),

    car: {
      ordinal: s32(212),
      class: s32(216),
      pi: s32(220),
      drivetrain: s32(224),
      cylinders: s32(228)
    },

    // 12-byte Horizon gap at 232..243

    position: { x: f32(244), y: f32(248), z: f32(252) },
    speedKmh: msToKmh(f32(256)),
    power: f32(260),
    torque: f32(264),

    tireTempC: {
      fl: fToC(f32(268)),
      fr: fToC(f32(272)),
      rl: fToC(f32(276)),
      rr: fToC(f32(280))
    },

    boost: f32(284),
    fuel: f32(288),

    lap: {
      distance: f32(292),
      best: f32(296),
      last: f32(300),
      current: f32(304),
      raceTime: f32(308),
      number: u16(312),
      racePosition: u8(314)
    },

    throttle: u8(315) / 255,
    brake: u8(316) / 255,
    clutch: u8(317) / 255,
    handBrake: u8(318) / 255,
    gear: u8(319),
    steer: s8(320) / 127,
    drivingLine: s8(321),
    aiBrakeDifference: s8(322),

    rawLength: buf.length
  }
}
