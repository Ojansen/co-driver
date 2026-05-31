/**
 * Canonical telemetry model — the "port" in the ports & adapters design.
 *
 * Every game's inbound adapter (server/adapters/<id>.ts) maps its wire format
 * onto this shape, and everything downstream (bus, recorder, rolling
 * aggregators, WS, client) depends only on this — never on a game's byte
 * layout. The FH6 byte offsets live in server/adapters/fh6.ts; field meanings
 * are documented in DESIGN.md §2.
 */

export interface Quad {
  fl: number
  fr: number
  rl: number
  rr: number
}

export interface Telemetry {
  isRaceOn: boolean
  timestampMs: number

  rpm: number
  rpmMax: number
  rpmIdle: number

  speedKmh: number
  power: number
  // Torque and boost are Forza channels with no equivalent in some feeds
  // (e.g. F1 exposes engine power but not flywheel torque, and has no
  // turbo-boost gauge) — null when a game's adapter can't provide them.
  torque: number | null
  boost: number | null

  gear: number
  throttle: number
  brake: number
  clutch: number
  handBrake: number
  steer: number
  /** Forza's per-frame measure of how far off the ideal racing line the car is
   *  (offset 321, s8 -128..127). Available since FH5; null on older blobs that
   *  predate the decoder reading this field. */
  drivingLine: number | null
  /** Difference between the player's braking and the AI's optimal braking at
   *  this frame (offset 322, s8). Decoded for completeness; not rendered yet. */
  aiBrakeDifference: number | null

  suspension: Quad
  suspensionMeters: Quad
  slipRatio: Quad
  slipAngle: Quad
  combinedSlip: Quad
  tireTempC: Quad
  // Game-specific channels — null when a game's adapter can't provide them.
  // FH6 fills all of these; other feeds may omit wheel rotation, rumble-strip
  // contact, puddle depth, or fuel level entirely.
  wheelRotation: Quad | null
  rumble: { fl: boolean, fr: boolean, rl: boolean, rr: boolean } | null
  puddle: Quad | null

  yaw: number
  pitch: number
  roll: number

  position: { x: number, y: number, z: number }
  velocity: { x: number, y: number, z: number }
  acceleration: { x: number, y: number, z: number }
  angularVelocity: { x: number, y: number, z: number }

  car: {
    ordinal: number
    class: number
    pi: number
    drivetrain: number
    cylinders: number
  }

  lap: {
    number: number
    racePosition: number
    current: number
    last: number
    best: number
    raceTime: number
    distance: number
  }

  fuel: number | null
  rawLength: number
}
