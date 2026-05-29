/**
 * Dev-only demo seeder. Hit with `curl -X POST http://localhost:3000/api/_dev/seed`.
 *
 * Inserts a handful of "[demo] ..." events with two sessions each (different
 * tune labels on the same car), two procedurally-generated laps per session.
 * Lap frames are realistic enough to drive the compare overlay, the replay
 * player, and the leaderboard.
 *
 * Idempotent: if any "[demo] Goliath" event already exists, the endpoint
 * returns `{ already: true }` and inserts nothing. To re-seed: delete the
 * demo events from the UI first.
 */

import { and, eq, like } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import type { Telemetry } from '~~/server/utils/decode'
import { encodeFrames } from '~~/server/utils/frames-codec'

export default defineEventHandler(async () => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, statusMessage: 'not found' })
  }

  const existing = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.type, 'race'), like(schema.events.name, '[demo]%')))
    .limit(1)
  if (existing.length > 0) {
    return { already: true, message: 'Demo data already present. Delete demo events first if you want to re-seed.' }
  }

  const carHypercar = await ensureCar(2300, 6, 'Demo Hypercar')
  const carGT = await ensureCar(2301, 5, 'Demo GT')

  let sessionsCreated = 0
  let lapsCreated = 0

  // Event 1 — circuit race with two tune sessions on the Hypercar.
  const goliath = await insertEvent('[demo] Goliath', 'race')
  await insertSession(goliath, carHypercar, 'stock', 845, [
    { lapNumber: 2, profile: 'warmup', length: 1500 },
    { lapNumber: 3, profile: 'fast', length: 1500 }
  ])
  await insertSession(goliath, carHypercar, 'softer rear', 851, [
    { lapNumber: 2, profile: 'warmup', length: 1500 },
    { lapNumber: 3, profile: 'fastest', length: 1500 }
  ])
  sessionsCreated += 2
  lapsCreated += 4

  // Event 2 — street race with two cars (GT vs Hypercar) at lower PI to show
  // class differences on the leaderboard.
  const sprint = await insertEvent('[demo] Festival Sprint', 'street_race')
  await insertSession(sprint, carGT, 'race build', 798, [
    { lapNumber: 2, profile: 'warmup', length: 1100 },
    { lapNumber: 3, profile: 'fast', length: 1100 }
  ])
  await insertSession(sprint, carHypercar, 'aero heavy', 845, [
    { lapNumber: 2, profile: 'fast', length: 1100 },
    { lapNumber: 3, profile: 'fastest', length: 1100 }
  ])
  sessionsCreated += 2
  lapsCreated += 4

  // Event 3 — freeroam with one session, one lap (single-session sanity check).
  const coastal = await insertEvent('[demo] Coastal Loop', 'freeroam')
  await insertSession(coastal, carGT, 'cruise', 798, [
    { lapNumber: 2, profile: 'warmup', length: 1800 }
  ])
  sessionsCreated += 1
  lapsCreated += 1

  return {
    seeded: true,
    events: 3,
    cars: 2,
    sessionsCreated,
    lapsCreated
  }
})

// --- helpers ----------------------------------------------------------------

async function ensureCar(ordinal: number, klass: number, displayName: string): Promise<{ id: number, ordinal: number, klass: number }> {
  const existing = (await db.select().from(schema.cars).where(eq(schema.cars.ordinal, ordinal)).limit(1))[0]
  if (existing) return { id: existing.id, ordinal, klass: existing.class }
  const row = (await db.insert(schema.cars).values({ ordinal, class: klass, displayName }).returning())[0]!
  return { id: row.id, ordinal, klass }
}

async function insertEvent(name: string, type: 'race' | 'freeroam' | 'street_race' | 'touge' | 'rally' | 'cross_country' | 'drag'): Promise<number> {
  const row = (await db.insert(schema.events).values({ name, type }).returning())[0]!
  return row.id
}

interface LapSpec {
  lapNumber: number
  profile: 'warmup' | 'fast' | 'fastest'
  length: number
}

async function insertSession(
  eventId: number,
  car: { id: number, ordinal: number, klass: number },
  tuneLabel: string,
  pi: number,
  laps: LapSpec[]
): Promise<void> {
  const startedAt = new Date(Date.now() - randomMinutes(60, 60 * 24 * 7))
  const sessionLengthMs = laps.length * 90_000 + 30_000
  const endedAt = new Date(startedAt.getTime() + sessionLengthMs)

  const session = (await db.insert(schema.sessions).values({
    eventId,
    carId: car.id,
    tuneLabel,
    piAtStart: pi,
    startedAt,
    endedAt
  }).returning())[0]!

  for (const spec of laps) {
    const { frames, timeMs } = generateLap(spec, car, pi, startedAt)
    const blob = encodeFrames(frames)
    await db.insert(schema.laps).values({
      sessionId: session.id,
      lapNumber: spec.lapNumber,
      timeMs,
      framesBlob: blob
    })
  }
}

interface LapResult {
  frames: Telemetry[]
  timeMs: number
}

/**
 * Procedurally generate a believable lap. The "track" is a fixed shape per
 * length so two laps with the same length share corners at the same distance
 * — making the compare overlay show real braking-zone alignment.
 *
 * Profile decides how aggressive the driver is. 60Hz frames.
 */
function generateLap(spec: LapSpec, car: { ordinal: number, klass: number }, pi: number, sessionStart: Date): LapResult {
  const HZ = 60
  const dt = 1 / HZ
  const targetSpeedMps = spec.profile === 'fastest' ? 35 : spec.profile === 'fast' ? 32 : 28

  // 3 corners spaced evenly through the lap; each is a brake-corner-throttle event.
  const cornerCenters = [0.22, 0.55, 0.82].map(p => p * spec.length)

  const frames: Telemetry[] = []
  let distance = 0
  let speedMps = targetSpeedMps * 0.6 // grid-start
  let lapTime = 0
  const baseTimestamp = sessionStart.getTime()

  while (distance < spec.length) {
    // Brake/throttle/steer based on nearest corner's distance.
    let throttle = 1
    let brake = 0
    let steer = 0
    for (let i = 0; i < cornerCenters.length; i++) {
      const c = cornerCenters[i]!
      const dist = distance - c
      const sign = i % 2 === 0 ? 1 : -1
      if (dist > -80 && dist < -20) {
        // braking zone before corner
        brake = Math.min(1, (-dist - 20) / 60 * 0.9 + (spec.profile === 'warmup' ? 0.1 : 0))
        throttle = 0
      } else if (dist >= -20 && dist <= 40) {
        // apex
        throttle = spec.profile === 'fastest' ? 0.45 : 0.35
        brake = 0
        steer = sign * (0.55 + (spec.profile === 'warmup' ? 0.05 : 0))
      } else if (dist > 40 && dist < 90) {
        // exit
        throttle = Math.min(1, (dist - 40) / 50)
        steer = sign * 0.2 * (1 - (dist - 40) / 50)
      }
    }

    // Slight noise so the trace isn't perfectly clean.
    throttle = clamp(throttle + jitter(0.03), 0, 1)
    brake = clamp(brake + jitter(0.02), 0, 1)
    steer = clamp(steer + jitter(0.02), -1, 1)

    // Simple speed integrator.
    const accel = (throttle * 8 - brake * 18) * (1 - speedMps / (targetSpeedMps * 1.1))
    speedMps = Math.max(8, speedMps + accel * dt)
    distance += speedMps * dt
    lapTime += dt

    frames.push(makeFrame({
      distance,
      lapTime,
      lapNumber: spec.lapNumber,
      throttle,
      brake,
      steer,
      speedMps,
      timestampMs: baseTimestamp + Math.floor(lapTime * 1000),
      car,
      pi
    }))
  }

  return { frames, timeMs: Math.round(lapTime * 1000) }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function jitter(amplitude: number): number {
  return (Math.random() - 0.5) * 2 * amplitude
}

function randomMinutes(loMin: number, hiMin: number): number {
  return (loMin + Math.random() * (hiMin - loMin)) * 60_000
}

interface FrameInputs {
  distance: number
  lapTime: number
  lapNumber: number
  throttle: number
  brake: number
  steer: number
  speedMps: number
  timestampMs: number
  car: { ordinal: number, klass: number }
  pi: number
}

function makeFrame(i: FrameInputs): Telemetry {
  const speedKmh = i.speedMps * 3.6
  const rpmFraction = clamp(0.3 + (i.speedMps / 70) * 0.6 + i.throttle * 0.1, 0.2, 0.98)
  const rpmMax = 8500
  const rpm = rpmMax * rpmFraction
  const gear = i.speedMps < 8 ? 2 : i.speedMps < 18 ? 3 : i.speedMps < 28 ? 4 : i.speedMps < 40 ? 5 : 6
  const lateralG = i.steer * (i.speedMps / 30)
  const longG = i.throttle * 6 - i.brake * 14

  // Suspension compresses with brake (front) and throttle (rear).
  const susFront = clamp(0.4 + i.brake * 0.5 + Math.abs(i.steer) * 0.05, 0, 1)
  const susRear = clamp(0.4 + i.throttle * 0.3 + Math.abs(i.steer) * 0.05, 0, 1)

  // Tire temps climb with combined slip and lateral load.
  const baseTemp = 75 + i.lapTime * 0.4
  const tempFL = baseTemp + (i.steer > 0 ? Math.abs(i.steer) * 18 : 4)
  const tempFR = baseTemp + (i.steer < 0 ? Math.abs(i.steer) * 18 : 4)
  const tempRL = baseTemp + i.throttle * 8
  const tempRR = baseTemp + i.throttle * 8

  return {
    isRaceOn: true,
    timestampMs: i.timestampMs,
    rpm,
    rpmMax,
    rpmIdle: 900,
    speedKmh,
    power: i.throttle * 600_000,
    torque: i.throttle * 700,
    boost: i.throttle * 1.2,
    gear,
    throttle: i.throttle,
    brake: i.brake,
    clutch: 0,
    handBrake: 0,
    steer: i.steer,
    drivingLine: 0,
    aiBrakeDifference: 0,
    suspension: { fl: susFront, fr: susFront, rl: susRear, rr: susRear },
    suspensionMeters: { fl: susFront * 0.06, fr: susFront * 0.06, rl: susRear * 0.06, rr: susRear * 0.06 },
    slipRatio: { fl: 0, fr: 0, rl: i.throttle * 0.12, rr: i.throttle * 0.12 },
    slipAngle: { fl: -lateralG * 0.02, fr: -lateralG * 0.02, rl: -lateralG * 0.015, rr: -lateralG * 0.015 },
    combinedSlip: { fl: Math.abs(lateralG) * 0.02, fr: Math.abs(lateralG) * 0.02, rl: Math.abs(lateralG) * 0.015 + i.throttle * 0.12, rr: Math.abs(lateralG) * 0.015 + i.throttle * 0.12 },
    tireTempC: { fl: tempFL, fr: tempFR, rl: tempRL, rr: tempRR },
    wheelRotation: { fl: i.speedMps / 0.33, fr: i.speedMps / 0.33, rl: i.speedMps / 0.33, rr: i.speedMps / 0.33 },
    rumble: { fl: false, fr: false, rl: false, rr: false },
    puddle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    yaw: i.steer * 0.5,
    pitch: longG * 0.005,
    roll: lateralG * 0.01,
    position: {
      x: i.distance * Math.cos(i.distance * 0.005),
      y: 12,
      z: i.distance * Math.sin(i.distance * 0.005)
    },
    velocity: { x: i.speedMps, y: 0, z: 0 },
    acceleration: { x: longG, y: 0, z: lateralG },
    angularVelocity: { x: 0, y: i.steer * 1.5, z: 0 },
    car: {
      ordinal: i.car.ordinal,
      class: i.car.klass,
      pi: i.pi,
      drivetrain: 2,
      cylinders: 8
    },
    lap: {
      number: i.lapNumber,
      racePosition: 1,
      current: i.lapTime,
      last: 0,
      best: 0,
      raceTime: i.lapTime + (i.lapNumber - 1) * 60,
      distance: i.distance
    },
    fuel: 0.7,
    rawLength: 324
  }
}
