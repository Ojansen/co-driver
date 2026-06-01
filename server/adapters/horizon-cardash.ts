/**
 * Forza "Data Out" Car Dash decoder — shared by every Forza title.
 *
 * All Forza games emit the same little-endian Sled portion (offsets 0..231),
 * then a Dash extension. The two families differ only in where the Dash starts:
 *
 *   - Horizon (FH4/FH5/FH6): a 12-byte gap after the Sled, so the Dash sits at
 *     offset 244 — a 324-byte packet.
 *   - Motorsport (FM7, FM 2023): no gap, Dash sits at offset 232 (12 bytes
 *     earlier) — a 311-byte packet. FM 2023 appends per-tire wear + a track
 *     ordinal (→ 331 bytes); those trailing fields aren't mapped yet, so the
 *     first 311 bytes are decoded identically to FM7.
 *
 * So one decoder backs all of them, parameterised by the Dash base offset. The
 * Sled offsets are fixed; the Dash reads are `dashBase + delta`. Field meanings
 * are documented in DESIGN.md §2.
 */

import type { Quad, Telemetry } from '../utils/decode'

export const HORIZON_CAR_DASH_BYTES = 324
/** Minimum length of a Motorsport Dash packet (FM7 = 311; FM 2023 = 331). */
export const MOTORSPORT_CAR_DASH_BYTES = 311

const HORIZON_DASH_BASE = 244
const MOTORSPORT_DASH_BASE = 232

const fToC = (f: number): number => (f - 32) * 5 / 9
const msToKmh = (ms: number): number => ms * 3.6

function decodeForzaCarDash(buf: Buffer, dashBase: number): Telemetry {
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

  // Dash reads are relative to dashBase (Horizon 244, Motorsport 232).
  const d = dashBase

  return {
    // --- Sled (fixed offsets 0..231, identical across titles) ---
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

    // --- Dash (relative to dashBase) ---
    position: { x: f32(d), y: f32(d + 4), z: f32(d + 8) },
    speedKmh: msToKmh(f32(d + 12)),
    power: f32(d + 16),
    torque: f32(d + 20),

    tireTempC: {
      fl: fToC(f32(d + 24)),
      fr: fToC(f32(d + 28)),
      rl: fToC(f32(d + 32)),
      rr: fToC(f32(d + 36))
    },

    boost: f32(d + 40),
    fuel: f32(d + 44),

    lap: {
      distance: f32(d + 48),
      best: f32(d + 52),
      last: f32(d + 56),
      current: f32(d + 60),
      raceTime: f32(d + 64),
      number: u16(d + 68),
      racePosition: u8(d + 70)
    },

    throttle: u8(d + 71) / 255,
    brake: u8(d + 72) / 255,
    clutch: u8(d + 73) / 255,
    handBrake: u8(d + 74) / 255,
    gear: u8(d + 75),
    steer: s8(d + 76) / 127,
    drivingLine: s8(d + 77),
    aiBrakeDifference: s8(d + 78),

    rawLength: buf.length
  }
}

/** Horizon (FH4/FH5/FH6): 324-byte Car Dash, Dash at offset 244. */
export function decodeHorizonCarDash(buf: Buffer): Telemetry | null {
  if (buf.length < HORIZON_CAR_DASH_BYTES) return null
  return decodeForzaCarDash(buf, HORIZON_DASH_BASE)
}

/** Motorsport (FM7 / FM 2023): Dash at offset 232; ≥311 bytes. */
export function decodeMotorsportCarDash(buf: Buffer): Telemetry | null {
  if (buf.length < MOTORSPORT_CAR_DASH_BYTES) return null
  return decodeForzaCarDash(buf, MOTORSPORT_DASH_BASE)
}

/**
 * Forza "Data Out" dispatcher — routes by packet length, since FM and Horizon
 * share the same in-game feature (and, in this app, the same UDP port). Horizon
 * is exactly 324 bytes; Motorsport is 311 (FM7) or 331 (FM 2023), so anything
 * else ≥311 is decoded as Motorsport. Used by every Forza adapter.
 */
export function decodeForzaDataOut(buf: Buffer): Telemetry | null {
  if (buf.length === HORIZON_CAR_DASH_BYTES) return decodeForzaCarDash(buf, HORIZON_DASH_BASE)
  if (buf.length >= MOTORSPORT_CAR_DASH_BYTES) return decodeForzaCarDash(buf, MOTORSPORT_DASH_BASE)
  return null
}
