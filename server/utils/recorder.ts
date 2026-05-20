/**
 * Recording state machine for v3. See DESIGN.md §8.3.
 *
 * IDLE → RECORDING → IDLE, driven by start()/stop() calls.
 * Lives in the server so recording survives browser refresh and the UDP
 * stream + DB are both adjacent.
 *
 * Lap-flushing rule: the first LapNumber transition after start() is a
 * mid-lap join (the lap started before recording began) — discard. Every
 * later transition is a fully-captured lap; gzip the frame buffer and
 * insert a `laps` row with time_ms = LastLap from the new packet.
 *
 * stop() discards the in-progress buffer (partial lap), finalizes the
 * session, and emits a `tune_prompt` if PI shifted vs the car's previous
 * session.
 */

import { gzipSync } from 'node:zlib'
import { desc, eq } from 'drizzle-orm'
import { db, schema } from 'hub:db'
import type { Telemetry } from './decode'
import { forzaBus, type RecordingState, type TunePrompt } from './forza-bus'

interface RecordingContext {
  sessionId: number
  eventId: number
  carId: number
  carOrdinal: number
  piAtStart: number
  previousPi: number | null
  startedAt: Date
  lastLapNumber: number
  lapInProgressFromStart: boolean
  buffer: Telemetry[]
  lapsCompleted: number
}

class Recorder {
  private latestFrame: Telemetry | null = null
  private ctx: RecordingContext | null = null

  constructor() {
    forzaBus.on('telemetry', t => this.onTelemetry(t))
  }

  getState(): RecordingState {
    if (!this.ctx) return { state: 'idle' }
    return {
      state: 'recording',
      sessionId: this.ctx.sessionId,
      eventId: this.ctx.eventId,
      carOrdinal: this.ctx.carOrdinal,
      lapsCompleted: this.ctx.lapsCompleted
    }
  }

  async start(eventId: number, tuneLabel: string | null = null): Promise<RecordingState> {
    if (this.ctx) return this.getState()
    const frame = this.latestFrame
    if (!frame) {
      throw new Error('No telemetry frame received yet — start the race in-game first')
    }

    const event = await db.select().from(schema.events).where(eq(schema.events.id, eventId)).limit(1)
    if (event.length === 0) {
      throw new Error(`Unknown event id ${eventId}`)
    }

    const ordinal = frame.car.ordinal
    const existingCar = (await db.select().from(schema.cars).where(eq(schema.cars.ordinal, ordinal)).limit(1))[0]
    const car = existingCar ?? (await db.insert(schema.cars)
      .values({ ordinal, class: frame.car.class })
      .returning())[0]!

    const prevSession = (await db.select()
      .from(schema.sessions)
      .where(eq(schema.sessions.carId, car.id))
      .orderBy(desc(schema.sessions.startedAt))
      .limit(1))[0]

    const startedAt = new Date()
    const session = (await db.insert(schema.sessions)
      .values({
        eventId,
        carId: car.id,
        tuneLabel,
        piAtStart: frame.car.pi,
        startedAt
      })
      .returning())[0]!

    this.ctx = {
      sessionId: session.id,
      eventId,
      carId: car.id,
      carOrdinal: ordinal,
      piAtStart: frame.car.pi,
      previousPi: prevSession?.piAtStart ?? null,
      startedAt,
      lastLapNumber: frame.lap.number,
      lapInProgressFromStart: false,
      buffer: [frame],
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

    const endedAt = new Date()
    await db.update(schema.sessions)
      .set({ endedAt })
      .where(eq(schema.sessions.id, ctx.sessionId))

    const idle: RecordingState = { state: 'idle' }
    forzaBus.emit('recording_state', idle)

    if (ctx.previousPi !== null && ctx.previousPi !== ctx.piAtStart) {
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
    const ctx = this.ctx
    if (!ctx) return

    if (t.lap.number !== ctx.lastLapNumber) {
      if (ctx.lapInProgressFromStart && ctx.buffer.length > 0) {
        const completedLapNumber = ctx.lastLapNumber
        const lapTimeMs = Math.round(t.lap.last * 1000)
        const frames = ctx.buffer.slice()
        void this.flushLap(ctx.sessionId, completedLapNumber, lapTimeMs, frames)
        ctx.lapsCompleted += 1
      }
      ctx.lastLapNumber = t.lap.number
      ctx.buffer = []
      ctx.lapInProgressFromStart = true
      forzaBus.emit('recording_state', this.getState())
    }

    ctx.buffer.push(t)
  }

  private async flushLap(sessionId: number, lapNumber: number, timeMs: number, frames: Telemetry[]): Promise<void> {
    try {
      const blob = gzipSync(Buffer.from(JSON.stringify(frames), 'utf8'))
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
}

export const recorder = new Recorder()
