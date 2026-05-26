/**
 * Rolling TB% — server-side trail-braking ratio computed over a sliding
 * 30 s window of the live telemetry stream, broadcast at ~5 Hz over the
 * bus so connected /live clients can render it alongside the trace strip.
 *
 * Single long-lived singleton subscribed to forzaBus.on('telemetry'). The
 * computation runs unconditionally — freeroam or recorded session, doesn't
 * matter. Only gates on `isRaceOn`, so the window freezes during pause
 * menus and loading screens (per [[project_is_race_on_semantic]]: the bit
 * is "data is live", not "an event is running").
 *
 * Reuses the pure detector from app/utils/trail-braking.ts — same code path
 * that drives the per-lap TB% on completed sessions, just fed a moving
 * window instead of a whole-lap frames blob.
 */

import { summarizeTrailBraking } from '../../app/utils/trail-braking'
import type { Telemetry } from './decode'
import { forzaBus } from './forza-bus'

const WINDOW_MS = 30_000
/** Emit one measurement per N frames at 60 Hz fan-out (≈5 Hz). */
const EMIT_EVERY_N_FRAMES = 12
/** Backwards-jump threshold for clearing the window on race-to-race
 *  transitions: Forza's per-race clock resets to 0 between events. */
const CLOCK_RESET_GAP_MS = 1000

interface WindowFrame {
  timestampMs: number
  brake: number
  steer: number
}

export class RollingTbPercent {
  private window: WindowFrame[] = []
  private frameCounter = 0

  constructor() {
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

    this.window.push({ timestampMs: newT, brake: t.brake, steer: t.steer })

    // Drop frames older than WINDOW_MS off the front.
    const cutoff = newT - WINDOW_MS
    let drop = 0
    while (drop < this.window.length && this.window[drop]!.timestampMs < cutoff) drop++
    if (drop > 0) this.window.splice(0, drop)

    this.frameCounter++
    if (this.frameCounter % EMIT_EVERY_N_FRAMES !== 0) return

    const summary = summarizeTrailBraking(this.window)
    const startMs = this.window[0]!.timestampMs
    const endMs = newT
    // brakingFrames === 0 → no braking in window. NaN is the right wire
    // signal here ("undefined ratio"); the client renders that as "—".
    const value = summary.brakingFrames > 0 ? summary.ratio : Number.NaN

    forzaBus.emit('measurement', {
      name: 'tb_rolling',
      value,
      startMs,
      endMs
    })
  }
}

export const rollingTbPercent = new RollingTbPercent()
