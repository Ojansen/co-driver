import { EventEmitter } from 'node:events'
import type { Telemetry } from './decode'

export type RecordingState
  = | { state: 'idle' }
    | {
      state: 'recording'
      sessionId: number
      eventId: number
      carOrdinal: number
      // Display-only context — lets the live recording banner show what's
      // actually being captured so the driver can sanity-check the picked
      // car / class / PI / tune mid-session.
      carDisplayName: string | null
      carClass: number
      piAtStart: number
      tuneLabel: string | null
      lapsCompleted: number
    }

export interface TunePrompt {
  sessionId: number
  carOrdinal: number
  previousPi: number
  currentPi: number
}

export interface ForzaStatus {
  connected: boolean
  lastPacketAt: number | null
}

/**
 * A contiguous stretch where a measurement's underlying predicate held — e.g.
 * one trail-braking band. Timestamps are game-clock ms, matching the same
 * x-axis the trace strip renders against. The full set of bands inside the
 * rolling window is re-sent on every emit (cheap — a handful per window —
 * and robust to dropped frames); the client dedupes by `startMs`.
 */
export interface MeasurementBand {
  startMs: number
  endMs: number
}

/**
 * Live derived measurement, emitted by server-side rolling-window aggregators
 * (see e.g. RollingTbPercent). Generic shape so adding a new measurement is
 * one bus emit + one WS forward, no schema churn.
 *
 * `startMs` and `endMs` are game-clock timestamps that let the client anchor
 * each reading to the same x-axis the trace strip renders against.
 */
export interface MeasurementEvent {
  name: 'tb_rolling' | 'time_coast' | 'pedal_overlap'
  /** 0..1, or NaN when the window had no qualifying frames (e.g. no braking). */
  value: number
  startMs: number
  endMs: number
  /** Discrete predicate-true bands inside the window. Only TB% populates this;
   *  the line measurements omit it and render as a continuous sparkline. */
  bands?: MeasurementBand[]
}

interface ForzaEvents {
  telemetry: [Telemetry]
  recording_state: [RecordingState]
  tune_prompt: [TunePrompt]
  forza_status: [ForzaStatus]
  measurement: [MeasurementEvent]
}

class ForzaBus extends EventEmitter<ForzaEvents> {}

export const forzaBus = new ForzaBus()
forzaBus.setMaxListeners(50)

let _status: ForzaStatus = { connected: false, lastPacketAt: null }
export function getForzaStatus(): ForzaStatus {
  return _status
}
// Updates lastPacketAt without emitting — used on every UDP packet (~60 Hz)
// so we don't flood the bus. Transitions go through setForzaStatus.
export function bumpForzaLastPacket(at: number): void {
  _status = { ..._status, lastPacketAt: at }
}
export function setForzaStatus(next: ForzaStatus): void {
  _status = next
  forzaBus.emit('forza_status', next)
}
