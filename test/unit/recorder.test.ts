/**
 * Recorder behaviour tests — focused on the §8.7 / issue #5 fix: the
 * "no LapNumber tick" → "single lap from buffer" fallback now runs for
 * every event type, and the `isRaceOn=false` clear is gated by the
 * run-started signal instead of the (removed) POINT_TO_POINT_TYPES set.
 *
 * Strategy: instantiate fresh `Recorder` instances in node environment,
 * mock `hub:db` with a chainable in-memory store, drive frames through
 * the real `forzaBus` singleton, assert on captured `laps` inserts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventType } from '../../server/db/schema'
import type { Telemetry, Quad } from '../../server/utils/decode'
import { decodeFrames } from '../../server/utils/frames-codec'

const { dbState, schemaRefs } = vi.hoisted(() => {
  const dbState = {
    eventType: 'race' as EventType,
    eventId: 1,
    nextSessionId: 1,
    nextLapId: 1,
    sessionsInserted: [] as Array<Record<string, unknown> & { id: number }>,
    sessionsUpdated: [] as Array<Record<string, unknown>>,
    lapsInserted: [] as Array<{ sessionId: number, lapNumber: number, timeMs: number, framesBlob: Buffer }>,
    reset(eventType: EventType): void {
      this.eventType = eventType
      this.nextSessionId = 1
      this.nextLapId = 1
      this.sessionsInserted = []
      this.sessionsUpdated = []
      this.lapsInserted = []
    }
  }
  // Schema-table refs are set up lazily inside the mock factory so that
  // the real schema module is loaded once and its table identities are
  // available for the mock's reference-equality checks.
  const schemaRefs: { real: typeof import('../../server/db/schema') | null } = { real: null }
  return { dbState, schemaRefs }
})

vi.mock('hub:db', async () => {
  const schema = await vi.importActual<typeof import('../../server/db/schema')>('../../server/db/schema')
  schemaRefs.real = schema

  function makeSelectChain() {
    const ctx: { table: unknown } = { table: null }
    const chain: Record<string, unknown> = {}
    chain.from = (t: unknown) => {
      ctx.table = t
      return chain
    }
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => chain
    chain.then = (resolve: (v: unknown) => void) => {
      if (ctx.table === schema.events) {
        resolve([{ id: dbState.eventId, name: 'test-event', type: dbState.eventType, createdAt: new Date() }])
      } else if (ctx.table === schema.cars) {
        resolve([{ id: 1, ordinal: 12345, class: 800, displayName: null }])
      } else if (ctx.table === schema.sessions) {
        // Previous-session lookup — empty, so no PI shift prompt fires.
        resolve([])
      } else {
        resolve([])
      }
    }
    return chain
  }

  function makeInsertChain(table: unknown) {
    const ctx: { table: unknown, values: Record<string, unknown> | null } = { table, values: null }
    const chain: Record<string, unknown> = {}
    chain.values = (v: Record<string, unknown>) => {
      ctx.values = v
      return chain
    }
    chain.returning = () => chain
    chain.then = (resolve: (v: unknown) => void) => {
      if (ctx.table === schema.sessions) {
        const row = { id: dbState.nextSessionId++, ...ctx.values }
        dbState.sessionsInserted.push(row)
        resolve([row])
      } else if (ctx.table === schema.laps) {
        const lap = ctx.values as { sessionId: number, lapNumber: number, timeMs: number, framesBlob: Buffer }
        dbState.lapsInserted.push(lap)
        resolve(undefined)
      } else if (ctx.table === schema.cars) {
        // Unused in tests (we always pre-seed an existing car) but kept for completeness.
        resolve([{ id: 2, ordinal: (ctx.values?.ordinal as number) ?? 0, class: (ctx.values?.class as number) ?? 0, displayName: null }])
      } else {
        resolve(undefined)
      }
    }
    return chain
  }

  function makeUpdateChain(table: unknown) {
    const ctx: { table: unknown, set: Record<string, unknown> | null } = { table, set: null }
    const chain: Record<string, unknown> = {}
    chain.set = (v: Record<string, unknown>) => {
      ctx.set = v
      return chain
    }
    chain.where = () => chain
    chain.then = (resolve: (v: unknown) => void) => {
      if (ctx.table === schema.sessions && ctx.set) dbState.sessionsUpdated.push(ctx.set)
      resolve(undefined)
    }
    return chain
  }

  const db = {
    select: () => makeSelectChain(),
    insert: (t: unknown) => makeInsertChain(t),
    update: (t: unknown) => makeUpdateChain(t)
  }
  return { db, schema }
})

// Import the bus and recorder AFTER vi.mock is registered. forzaBus is the
// real singleton; each test instantiates a fresh Recorder which subscribes
// its own listener. We tear down listeners between tests for isolation.
const { forzaBus } = await import('../../server/utils/forza-bus')
const { Recorder } = await import('../../server/utils/recorder')

const ALL_EVENT_TYPES: readonly EventType[] = [
  'race', 'street_race', 'touge', 'rally', 'cross_country', 'drag', 'custom', 'freeroam'
]

interface FrameOpts {
  lapNumber: number
  isRaceOn: boolean
  timestampMs: number
  lapLast?: number
}

function makeFrame({ lapNumber, isRaceOn, timestampMs, lapLast = 0 }: FrameOpts): Telemetry {
  // A complete canonical frame — the columnar codec the recorder now writes
  // serialises every field, so the test data must be a full Telemetry (the
  // real adapters always emit one). The recorder only reads isRaceOn / lap /
  // timestampMs; the rest are inert defaults.
  const q = (): Quad => ({ fl: 0, fr: 0, rl: 0, rr: 0 })
  const v3 = () => ({ x: 0, y: 0, z: 0 })
  return {
    isRaceOn,
    timestampMs,
    rpm: 0, rpmMax: 0, rpmIdle: 0,
    speedKmh: 0, power: 0, torque: 0, boost: 0,
    gear: 0, throttle: 0, brake: 0, clutch: 0, handBrake: 0, steer: 0,
    drivingLine: null, aiBrakeDifference: null,
    suspension: q(), suspensionMeters: q(), slipRatio: q(), slipAngle: q(), combinedSlip: q(), tireTempC: q(),
    wheelRotation: null, rumble: null, puddle: null,
    yaw: 0, pitch: 0, roll: 0,
    position: v3(), velocity: v3(), acceleration: v3(), angularVelocity: v3(),
    car: { ordinal: 12345, class: 800, pi: 745, drivetrain: 0, cylinders: 4 },
    lap: { number: lapNumber, racePosition: 1, current: 0, last: lapLast, best: 0, raceTime: 0, distance: 0 },
    fuel: null, rawLength: 324
  }
}

async function runScenario(eventType: EventType, frames: Telemetry[]): Promise<typeof dbState.lapsInserted> {
  dbState.reset(eventType)
  // Seed latestFrame so start() doesn't throw — the constructor of Recorder
  // subscribes to forzaBus.telemetry, so emitting one frame primes it.
  const recorder = new Recorder()
  forzaBus.emit('telemetry', makeFrame({ lapNumber: 0, isRaceOn: false, timestampMs: 0 }))
  await recorder.start(1, null)
  for (const f of frames) forzaBus.emit('telemetry', f)
  await recorder.stop()
  return dbState.lapsInserted
}

beforeEach(() => {
  // Make sure no stale listeners from prior tests fire during this one.
  forzaBus.removeAllListeners('telemetry')
  forzaBus.removeAllListeners('recording_state')
  forzaBus.removeAllListeners('tune_prompt')
})

afterEach(() => {
  forzaBus.removeAllListeners('telemetry')
})

describe('recorder — uniform fallback across all event types (issue #5)', () => {
  describe.each(ALL_EVENT_TYPES)('event type: %s', (eventType) => {
    it('point-to-point shape (0 LapNumber ticks) → 1 lap row from whole buffer', async () => {
      const frames: Telemetry[] = []
      for (let i = 0; i < 600; i++) {
        // ~10 s at 60 Hz, monotonic timestamps, lap.number stays at 0.
        frames.push(makeFrame({ lapNumber: 0, isRaceOn: true, timestampMs: 1000 + i * 16 }))
      }
      const laps = await runScenario(eventType, frames)
      expect(laps).toHaveLength(1)
      expect(laps[0]!.lapNumber).toBe(1)
      // timeMs ≈ last.timestampMs − first.timestampMs = 599 * 16 = 9584
      expect(laps[0]!.timeMs).toBe(9584)
      const replayed = decodeFrames(laps[0]!.framesBlob)
      expect(replayed).toHaveLength(600)
    })

    it('multi-lap shape (3 LapNumber transitions) → 2 lap rows via the LapNumber path', async () => {
      // lap.number sequence: 0 (×50) → 1 (×100) → 2 (×100) → 3 (×100). 3
      // transitions; the first is the discarded mid-lap join.
      const frames: Telemetry[] = []
      let t = 1000
      for (let i = 0; i < 50; i++) frames.push(makeFrame({ lapNumber: 0, isRaceOn: true, timestampMs: t += 16 }))
      // First transition: 0→1, mid-lap join, discarded. lap.last carries the bogus first-lap time.
      frames.push(makeFrame({ lapNumber: 1, isRaceOn: true, timestampMs: t += 16, lapLast: 70.5 }))
      for (let i = 0; i < 99; i++) frames.push(makeFrame({ lapNumber: 1, isRaceOn: true, timestampMs: t += 16 }))
      // Second transition: 1→2, real lap 1, lap.last is the just-completed time.
      frames.push(makeFrame({ lapNumber: 2, isRaceOn: true, timestampMs: t += 16, lapLast: 65.2 }))
      for (let i = 0; i < 99; i++) frames.push(makeFrame({ lapNumber: 2, isRaceOn: true, timestampMs: t += 16 }))
      // Third transition: 2→3, real lap 2.
      frames.push(makeFrame({ lapNumber: 3, isRaceOn: true, timestampMs: t += 16, lapLast: 63.8 }))
      for (let i = 0; i < 99; i++) frames.push(makeFrame({ lapNumber: 3, isRaceOn: true, timestampMs: t += 16 }))

      const laps = await runScenario(eventType, frames)
      expect(laps).toHaveLength(2)
      expect(laps[0]!.lapNumber).toBe(1)
      expect(laps[0]!.timeMs).toBe(Math.round(65.2 * 1000))
      expect(laps[1]!.lapNumber).toBe(2)
      expect(laps[1]!.timeMs).toBe(Math.round(63.8 * 1000))
    })

    it('finish-line UI flip after run started → buffer preserved, fallback flushes', async () => {
      // 300 isRaceOn=true frames (well above the 120-frame "run started" threshold),
      // then 60 isRaceOn=false frames (the finish UI). Without the run-started
      // guard this would clear the buffer and the session would be empty.
      const frames: Telemetry[] = []
      let t = 1000
      for (let i = 0; i < 300; i++) frames.push(makeFrame({ lapNumber: 0, isRaceOn: true, timestampMs: t += 16 }))
      const lastRunFrameTs = t
      for (let i = 0; i < 60; i++) frames.push(makeFrame({ lapNumber: 0, isRaceOn: false, timestampMs: t += 16 }))

      const laps = await runScenario(eventType, frames)
      expect(laps).toHaveLength(1)
      expect(laps[0]!.lapNumber).toBe(1)
      // timeMs spans only the isRaceOn=true frames, since !isRaceOn frames never enter the buffer.
      expect(laps[0]!.timeMs).toBe(lastRunFrameTs - (1000 + 16))
      const replayed = decodeFrames(laps[0]!.framesBlob)
      expect(replayed).toHaveLength(300)
    })

    it('pre-event noise (isRaceOn=false while no run started) → cleared before the run', async () => {
      // 50 isRaceOn=false frames at the start (loading screen). These never
      // get buffered at all (the early return). Then 50 isRaceOn=true frames,
      // then a false transition while buffer.length=50 (< 120 threshold,
      // lapInProgressFromStart=false) → buffer cleared. Then 600 real frames.
      const frames: Telemetry[] = []
      let t = 1000
      for (let i = 0; i < 50; i++) frames.push(makeFrame({ lapNumber: 0, isRaceOn: false, timestampMs: t += 16 }))
      for (let i = 0; i < 50; i++) frames.push(makeFrame({ lapNumber: 0, isRaceOn: true, timestampMs: t += 16 }))
      // Loading screen flip — clears the 50 buffered frames.
      frames.push(makeFrame({ lapNumber: 0, isRaceOn: false, timestampMs: t += 16 }))
      const realRunStartTs = t + 16
      for (let i = 0; i < 600; i++) frames.push(makeFrame({ lapNumber: 0, isRaceOn: true, timestampMs: t += 16 }))

      const laps = await runScenario(eventType, frames)
      expect(laps).toHaveLength(1)
      const replayed = decodeFrames(laps[0]!.framesBlob)
      expect(replayed).toHaveLength(600)
      expect(replayed[0]!.timestampMs).toBe(realRunStartTs)
    })
  })
})

describe('recorder — edge cases', () => {
  it('stop with empty buffer (no isRaceOn=true frames received) → 0 lap rows', async () => {
    const frames: Telemetry[] = []
    for (let i = 0; i < 50; i++) frames.push(makeFrame({ lapNumber: 0, isRaceOn: false, timestampMs: 1000 + i * 16 }))
    const laps = await runScenario('race', frames)
    expect(laps).toHaveLength(0)
  })

  it('stop with 1-frame buffer → 0 lap rows (below the 2-frame minimum)', async () => {
    const frames = [makeFrame({ lapNumber: 0, isRaceOn: true, timestampMs: 1000 })]
    const laps = await runScenario('race', frames)
    expect(laps).toHaveLength(0)
  })

  it('start() before any telemetry → throws', async () => {
    dbState.reset('race')
    const recorder = new Recorder()
    await expect(recorder.start(1, null)).rejects.toThrow(/Forza running/)
  })

  it('start() when only paused/pre-race frames seen (ordinal 0) → throws with identity-specific message', async () => {
    // Mirrors the real-world bug: app is up, Forza is on the pause menu or
    // pre-race UI, so every packet so far has car.ordinal=0. The session
    // would otherwise be created with ordinal 0.
    dbState.reset('race')
    const recorder = new Recorder()
    const zeroIdentityFrame = {
      isRaceOn: false,
      timestampMs: 0,
      lap: { number: 0, racePosition: 1, current: 0, last: 0, best: 0, raceTime: 0, distance: 0 },
      car: { ordinal: 0, class: 0, pi: 0, drivetrain: 0, cylinders: 0 }
    } as unknown as Telemetry
    forzaBus.emit('telemetry', zeroIdentityFrame)
    await expect(recorder.start(1, null)).rejects.toThrow(/car identity/)
  })

  it('start() during pause uses identity from the last live frame', async () => {
    // Real-world: race ran, player hit pause, then started recording. Latest
    // frame is the zeroed pause-menu packet; recorder must reach back to the
    // last valid identity frame.
    dbState.reset('race')
    const recorder = new Recorder()
    forzaBus.emit('telemetry', makeFrame({ lapNumber: 0, isRaceOn: true, timestampMs: 1000 }))
    const paused = {
      isRaceOn: false,
      timestampMs: 1100,
      lap: { number: 0, racePosition: 1, current: 0, last: 0, best: 0, raceTime: 0, distance: 0 },
      car: { ordinal: 0, class: 0, pi: 0, drivetrain: 0, cylinders: 0 }
    } as unknown as Telemetry
    forzaBus.emit('telemetry', paused)
    await recorder.start(1, null)
    expect(dbState.sessionsInserted).toHaveLength(1)
    expect(dbState.sessionsInserted[0]!.piAtStart).toBe(745)
  })

  it('session is ended on stop (endedAt set)', async () => {
    const frames: Telemetry[] = []
    for (let i = 0; i < 200; i++) frames.push(makeFrame({ lapNumber: 0, isRaceOn: true, timestampMs: 1000 + i * 16 }))
    await runScenario('race', frames)
    expect(dbState.sessionsUpdated).toHaveLength(1)
    expect(dbState.sessionsUpdated[0]).toHaveProperty('endedAt')
  })
})
