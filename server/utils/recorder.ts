/**
 * Recording state machine for v3. See DESIGN.md §8.3.
 *
 * IDLE → RECORDING → IDLE, driven by start()/stop() calls.
 * Lives in the server so recording survives browser refresh and the UDP
 * stream + DB are both adjacent.
 *
 * Live-data gating: frames where `isRaceOn === false` are never buffered.
 * The bit reads "the game's feeding live data right now", not "an event is
 * running" — so this filters loading screens, countdowns, the pause menu
 * and the post-finish UI uniformly. The buffer is additionally CLEARED on
 * `isRaceOn=false` *only while no real run has started yet* — so
 * driving-to-the-event-entrance frames get dropped at the loading screen,
 * but a completed run survives the finish-line UI flipping the bit off.
 *
 * Lap-flushing rule: a LapNumber transition flushes the buffered lap only if
 * it was caught from its start (the first buffered frame showed CurrentLap ≈
 * 0). That keeps the opening lap when Record was pressed during the pre-race
 * pause and the lap ran from the grid, while still discarding a genuine
 * mid-lap join (recording started partway through a lap — first buffered
 * frame already deep into CurrentLap). Each kept lap is gzipped and inserted
 * as a `laps` row with time_ms = LastLap from the transition packet.
 *
 * Point-to-point fallback: when stop() fires with zero completed laps but
 * a non-trivial buffer, the whole Start→Stop window is flushed as one
 * "lap" with time_ms = last.timestampMs − first.timestampMs. Applies to
 * every event type — FH6 has point-to-point routes under the race /
 * street_race classes too (issue #5), and there's no reliable way to tell
 * them apart from multi-lap races by event.type alone. Runtime detection
 * (did LapNumber ever tick?) is the discriminant. Multi-lap races still
 * land on the LapNumber-transition path; the fallback only fires when
 * lapsCompleted === 0.
 *
 * stop() finalizes the session and emits a `tune_prompt` if PI shifted vs
 * the car's previous session.
 */

import { and, desc, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import type { GameId } from '#shared/games'
import type { EventType } from './../db/schema'
import type { Telemetry } from './decode'
import { decodeFrame, encodeFrame, encodeFramesAsync } from './frames-codec'
import { forzaBus, type RecordingState, type TunePrompt } from './forza-bus'

/** Buffer length (frames at 60 Hz) past which we treat the run as "started"
 *  for the purposes of preserving the buffer across an isRaceOn=false
 *  transition. 120 ≈ 2 s. Either this OR a LapNumber tick flips the guard. */
const RUN_STARTED_MIN_FRAMES = 120

/** CurrentLap (seconds) below which the first buffered frame of a lap is
 *  treated as "caught from the start" — the lap clock had just reset, so the
 *  whole lap is in the buffer and gets flushed at the next LapNumber tick.
 *  Above it we assume a mid-lap join and discard the partial lap. At 60 Hz the
 *  gap between isRaceOn going true and our first frame is tiny, so the opening
 *  lap reads well under this; a genuine mid-lap join is always many s in. */
const LAP_START_EPSILON_S = 2

interface RecordingContext {
  sessionId: number
  gameId: GameId
  eventId: number
  eventType: EventType | null
  carId: number
  carOrdinal: number
  carDisplayName: string | null
  carClass: number
  piAtStart: number
  previousPi: number | null
  tuneLabel: string | null
  startedAt: Date
  lastLapNumber: number
  lapInProgressFromStart: boolean
  // Whether the lap currently being buffered was caught from its start (first
  // buffered frame showed CurrentLap ≈ 0). Re-evaluated each time a fresh lap
  // buffer is seeded. Drives keep-vs-discard at the next LapNumber tick: a
  // grid-start opening lap is kept; a mid-lap join is discarded. See §8.7.
  caughtLapStart: boolean
  // Raw datagrams, not decoded frames — a flat byte buffer per frame keeps the
  // live-set tiny on long un-lapped runs (point-to-point / free-roam), where
  // this used to hold tens of thousands of deep Telemetry objects and the GC
  // churn stalled the feed. Decoded back to frames once, at flush.
  buffer: Buffer[]
  // Game-clock bounds of the current buffer, tracked off the live decoded
  // frame so the point-to-point fallback doesn't have to decode to time itself.
  firstTimestampMs: number | null
  lastTimestampMs: number
  lapsCompleted: number
}

export class Recorder {
  private latestFrame: Telemetry | null = null
  // Most recent frame where the car identity block (ordinal/class/pi) was
  // actually populated. Forza zeros these out on the pause menu and on
  // pre-race UI even though packets keep arriving at 60Hz, so the latest
  // frame is unsafe to read identity from. We snapshot it the last time we
  // saw it valid and use that in start() — survives pauses cleanly.
  private lastLiveFrame: Telemetry | null = null
  private ctx: RecordingContext | null = null
  // Lap flushes run async (gzip off the event loop) and fire mid-race, so they
  // can't be awaited from the sync telemetry handler. Serialize them on a chain:
  // this keeps laps inserted in completion order, avoids concurrent gzips
  // competing on the thread pool, and gives stop() a single promise to await so
  // every lap is persisted before it resolves. flushLap catches internally, so
  // the chain never rejects.
  private flushChain: Promise<void> = Promise.resolve()

  constructor() {
    forzaBus.on('telemetry', t => this.onTelemetry(t))
  }

  private queueFlush(sessionId: number, lapNumber: number, timeMs: number, records: Buffer[]): void {
    this.flushChain = this.flushChain.then(() => this.flushLap(sessionId, lapNumber, timeMs, records))
  }

  getState(): RecordingState {
    if (!this.ctx) return { state: 'idle' }
    return {
      state: 'recording',
      sessionId: this.ctx.sessionId,
      eventId: this.ctx.eventId,
      carOrdinal: this.ctx.carOrdinal,
      carDisplayName: this.ctx.carDisplayName,
      carClass: this.ctx.carClass,
      piAtStart: this.ctx.piAtStart,
      tuneLabel: this.ctx.tuneLabel,
      lapsCompleted: this.ctx.lapsCompleted
    }
  }

  async start(gameId: GameId, eventId: number, tuneLabel: string | null = null): Promise<RecordingState> {
    if (this.ctx) return this.getState()
    const frame = this.lastLiveFrame
    if (!frame) {
      if (!this.latestFrame) {
        throw new Error('No telemetry frame received yet — is the game running with telemetry output enabled?')
      }
      throw new Error('Waiting for car identity — start your race in-game first (paused/pre-race packets carry ordinal 0)')
    }

    const event = (await db.select().from(schema.events).where(eq(schema.events.id, eventId)).limit(1))[0]
    if (!event) {
      throw new Error(`Unknown event id ${eventId}`)
    }
    // An event belongs to one game; recording it under a different active game
    // would mislabel the session (and bind the wrong per-game car catalog).
    if (event.gameId !== gameId) {
      throw new Error(`Event ${eventId} belongs to ${event.gameId}, not the active game ${gameId}`)
    }
    const eventType = event.type

    // Cars are namespaced per game — an ordinal is only unique within a game.
    const ordinal = frame.car.ordinal
    const existingCar = (await db.select().from(schema.cars)
      .where(and(eq(schema.cars.gameId, gameId), eq(schema.cars.ordinal, ordinal))).limit(1))[0]
    const car = existingCar ?? (await db.insert(schema.cars)
      .values({ gameId, ordinal, class: frame.car.class })
      .returning())[0]!

    const prevSession = (await db.select()
      .from(schema.sessions)
      .where(eq(schema.sessions.carId, car.id))
      .orderBy(desc(schema.sessions.startedAt))
      .limit(1))[0]

    const startedAt = new Date()
    const session = (await db.insert(schema.sessions)
      .values({
        gameId,
        eventId,
        carId: car.id,
        tuneLabel,
        piAtStart: frame.car.pi,
        startedAt
      })
      .returning())[0]!

    this.ctx = {
      sessionId: session.id,
      gameId,
      eventId,
      eventType,
      carId: car.id,
      carOrdinal: ordinal,
      carDisplayName: car.displayName ?? null,
      carClass: car.class,
      piAtStart: frame.car.pi,
      previousPi: prevSession?.piAtStart ?? null,
      tuneLabel,
      startedAt,
      lastLapNumber: frame.lap.number,
      lapInProgressFromStart: false,
      caughtLapStart: false,
      // Buffer starts empty — the first isRaceOn=true frame seeds it via
      // onTelemetry. Pre-event frames (driving to the event in freeroam,
      // lobby, countdown) never make it in.
      buffer: [],
      firstTimestampMs: null,
      lastTimestampMs: 0,
      lapsCompleted: 0
    }

    const state = this.getState()
    forzaBus.emit('recording_state', state)
    return state
  }

  async stop(): Promise<RecordingState> {
    if (!this.ctx) return { state: 'idle' }
    const ctx = this.ctx
    this.ctx = null

    // Point-to-point fallback (§8.7, issue #5): if LapNumber never ticked
    // during the recording, treat the whole Start→Stop window as one "lap".
    // Applies to every event type — FH6 has point-to-point routes under the
    // race / street_race classes too, and event.type alone can't tell us
    // whether a given session was multi-lap or point-to-point. Runtime
    // detection (did LapNumber ever tick?) is the only reliable signal.
    if (ctx.lapsCompleted === 0 && ctx.buffer.length >= 2) {
      const timeMs = Math.max(1, ctx.lastTimestampMs - (ctx.firstTimestampMs ?? ctx.lastTimestampMs))
      // `this.ctx` is already null (set at the top of stop), so handing the
      // buffer straight to the async flush is safe — nothing else touches it.
      this.queueFlush(ctx.sessionId, 1, timeMs, ctx.buffer)
      ctx.lapsCompleted = 1
    }

    // Drain the flush chain (this fallback + any mid-race lap boundaries) so
    // every lap is on disk before stop resolves.
    await this.flushChain

    const endedAt = new Date()
    await db.update(schema.sessions)
      .set({ endedAt })
      .where(eq(schema.sessions.id, ctx.sessionId))

    const idle: RecordingState = { state: 'idle' }
    forzaBus.emit('recording_state', idle)

    // PI (performance index) is a Forza concept; only FH6 has the tuning stack
    // a PI-shift prompt feeds into. Skip it for other sims.
    if (ctx.gameId === 'fh6' && ctx.previousPi !== null && ctx.previousPi !== ctx.piAtStart) {
      const prompt: TunePrompt = {
        sessionId: ctx.sessionId,
        carOrdinal: ctx.carOrdinal,
        previousPi: ctx.previousPi,
        currentPi: ctx.piAtStart
      }
      forzaBus.emit('tune_prompt', prompt)
    }

    return idle
  }

  private onTelemetry(t: Telemetry): void {
    this.latestFrame = t
    if (t.car.ordinal > 0) this.lastLiveFrame = t
    const ctx = this.ctx
    if (!ctx) return

    // Skip buffering while the game isn't feeding live data — loading
    // screens, countdowns, the in-game pause menu, the post-finish UI. The
    // `isRaceOn` bit reads "data is live", not "an event is happening" (see
    // memory: project_is_race_on_semantic), so we can't infer "the race is
    // over, dump the buffer" just from it going false.
    if (!t.isRaceOn) {
      // Pre-event garbage (driving to the event entrance, sitting in the
      // lobby) is worth dropping the moment the game shows a loading
      // screen. But the SAME `isRaceOn=false` signal fires at the *end* of
      // the run when the finish UI appears — clearing there would discard
      // the whole captured run. Only clear if no run-started signal has
      // fired yet (no LapNumber tick AND less than ~2 s of frames). After
      // that, !isRaceOn just pauses buffering. Applies to every event type.
      const runStarted = ctx.lapInProgressFromStart || ctx.buffer.length >= RUN_STARTED_MIN_FRAMES
      if (ctx.buffer.length > 0 && !runStarted) {
        ctx.buffer = []
        ctx.firstTimestampMs = null
        ctx.caughtLapStart = false
        ctx.lapInProgressFromStart = false
      }
      return
    }

    if (t.lap.number !== ctx.lastLapNumber) {
      // Flush the buffered lap iff we caught it from its start. A grid-start
      // opening lap (Record pressed during the pre-race pause, then resumed)
      // has caughtLapStart=true and is kept; a mid-lap join leaves it false
      // and the partial buffer is discarded. (Previously the *first*
      // transition was unconditionally discarded, which threw away the
      // opening lap of every race started from the pre-race menu.)
      if (ctx.caughtLapStart && ctx.buffer.length > 0) {
        const completedLapNumber = ctx.lastLapNumber
        const lapTimeMs = Math.round(t.lap.last * 1000)
        // Hand off the current buffer to the async flush and start a fresh one
        // — the old array is owned by flushLap from here.
        this.queueFlush(ctx.sessionId, completedLapNumber, lapTimeMs, ctx.buffer)
        ctx.lapsCompleted += 1
      }
      ctx.lastLapNumber = t.lap.number
      ctx.buffer = []
      ctx.firstTimestampMs = null
      ctx.caughtLapStart = false
      ctx.lapInProgressFromStart = true
      forzaBus.emit('recording_state', this.getState())
    }

    if (ctx.firstTimestampMs === null) {
      ctx.firstTimestampMs = t.timestampMs
      // First frame of a fresh lap buffer: a near-zero CurrentLap means the
      // lap clock just reset, so this lap is fully captured. A large value
      // means we joined mid-lap → the buffer is dropped at the next tick.
      ctx.caughtLapStart = t.lap.current < LAP_START_EPSILON_S
    }
    ctx.lastTimestampMs = t.timestampMs
    // Store a flat per-frame record, not the deep Telemetry object — one byte
    // block per frame keeps the live-set small over a long run.
    ctx.buffer.push(encodeFrame(t))
  }

  private async flushLap(sessionId: number, lapNumber: number, timeMs: number, records: Buffer[]): Promise<void> {
    try {
      const frames = await this.decodeBuffered(records)
      const blob = await encodeFramesAsync(frames)
      await db.insert(schema.laps).values({
        sessionId,
        lapNumber,
        timeMs,
        framesBlob: blob
      })
    } catch (err) {
      console.error('[recorder] failed to flush lap', err)
    }
  }

  // Decode the buffered per-frame records back into frames, yielding to the
  // event loop periodically so a long run (tens of thousands of frames)
  // doesn't block the 60 Hz feed at flush time.
  private async decodeBuffered(records: Buffer[]): Promise<Telemetry[]> {
    const frames: Telemetry[] = new Array<Telemetry>(records.length)
    for (let i = 0; i < records.length; i++) {
      frames[i] = decodeFrame(records[i]!)
      if ((i & 2047) === 2047) await new Promise<void>(resolve => setImmediate(resolve))
    }
    return frames
  }
}

export const recorder = new Recorder()
