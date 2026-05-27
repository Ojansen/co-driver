/**
 * Generic rolling-window measurement aggregator.
 *
 * Subscribes to forzaBus.on('telemetry'), keeps a sliding window of the last
 * `windowMs` of captured frames, and emits a single reduced value over the bus
 * every ~5 Hz (one emit per 12 frames at the 60 Hz fan-out).
 *
 * Each concrete measurement supplies three things:
 *   - `name`    — the MeasurementEvent name forwarded to clients.
 *   - `capture` — pulls just the channels this measurement needs off a frame,
 *                 keeping the window small (we never store whole Telemetry).
 *   - `reduce`  — folds the current window into one number (0..1, or NaN when
 *                 the reading is undefined for this window — see RollingTbPercent).
 *
 * Window hygiene shared by all consumers:
 *   - gates on `isRaceOn` so the window freezes during pause menus / loading
 *     ([[project_is_race_on_semantic]]: the bit is "data is live", not "an
 *     event is running");
 *   - clears the window on a large backwards timestamp jump, since Forza's
 *     per-race clock resets to 0 between events.
 */

import type { Telemetry } from './decode'
import { forzaBus, type MeasurementBand, type MeasurementEvent } from './forza-bus'

export const ROLLING_WINDOW_MS = 30_000
/** Emit one measurement per N frames at 60 Hz fan-out (≈5 Hz). */
const EMIT_EVERY_N_FRAMES = 12
/** Backwards-jump threshold for clearing the window on race-to-race
 *  transitions: Forza's per-race clock resets to 0 between events. */
const CLOCK_RESET_GAP_MS = 1000

export type WindowFrame<F> = F & { timestampMs: number }

/** A reduce can return just a value, or a value plus the discrete bands that
 *  make it up — the latter lets a measurement (TB%) compute both from a single
 *  pass over the window. Plain-number reducers (coast, overlap) stay as-is. */
export type ReduceResult = number | { value: number, bands?: MeasurementBand[] }

export interface RollingMeasurementConfig<F extends object> {
  name: MeasurementEvent['name']
  /** Pull the channels this measurement needs off a live frame. */
  capture: (t: Telemetry) => F
  /** Fold the current window into one value (0..1, or NaN when undefined),
   *  optionally with the predicate-true bands behind it. */
  reduce: (window: WindowFrame<F>[]) => ReduceResult
  /** Sliding-window span. Defaults to 30 s. */
  windowMs?: number
}

export class RollingMeasurement<F extends object> {
  private window: WindowFrame<F>[] = []
  private frameCounter = 0
  private readonly name: MeasurementEvent['name']
  private readonly capture: (t: Telemetry) => F
  private readonly reduce: (window: WindowFrame<F>[]) => ReduceResult
  private readonly windowMs: number

  constructor(config: RollingMeasurementConfig<F>) {
    this.name = config.name
    this.capture = config.capture
    this.reduce = config.reduce
    this.windowMs = config.windowMs ?? ROLLING_WINDOW_MS
    forzaBus.on('telemetry', t => this.onTelemetry(t))
  }

  private onTelemetry(t: Telemetry): void {
    // Game paused / loading / pre-race UI → freeze the window.
    if (!t.isRaceOn) return

    const newT = t.timestampMs
    const last = this.window[this.window.length - 1]
    // New race / clock reset: drop the stale window and restart.
    if (last && newT < last.timestampMs - CLOCK_RESET_GAP_MS) {
      this.window = []
    }

    this.window.push({ ...this.capture(t), timestampMs: newT } as WindowFrame<F>)

    // Drop frames older than windowMs off the front.
    const cutoff = newT - this.windowMs
    let drop = 0
    while (drop < this.window.length && this.window[drop]!.timestampMs < cutoff) drop++
    if (drop > 0) this.window.splice(0, drop)

    this.frameCounter++
    if (this.frameCounter % EMIT_EVERY_N_FRAMES !== 0) return

    const reduced = this.reduce(this.window)
    const value = typeof reduced === 'number' ? reduced : reduced.value
    const bands = typeof reduced === 'number' ? undefined : reduced.bands

    forzaBus.emit('measurement', {
      name: this.name,
      value,
      startMs: this.window[0]!.timestampMs,
      endMs: newT,
      ...(bands ? { bands } : {})
    })
  }
}
