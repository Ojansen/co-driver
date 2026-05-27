/**
 * Rolling TB% — server-side trail-braking ratio over a sliding 30 s window of
 * the live telemetry stream, broadcast at ~5 Hz so connected /live clients can
 * render it alongside the trace strip.
 *
 * Reuses the pure detector from app/utils/trail-braking.ts — same code path
 * that drives the per-lap TB% on completed sessions, just fed a moving window
 * instead of a whole-lap frames blob. Window hygiene (isRaceOn gate, clock
 * reset, trim, emit cadence) lives in RollingMeasurement.
 */

import { detectTrailBraking, trailBrakingBands, TRAIL_BRAKE_MIN } from '../../app/utils/trail-braking'
import { RollingMeasurement } from './rolling-window'

export class RollingTbPercent extends RollingMeasurement<{ brake: number, steer: number }> {
  constructor() {
    super({
      name: 'tb_rolling',
      capture: t => ({ brake: t.brake, steer: t.steer }),
      reduce: (window) => {
        // One detector pass feeds both the ratio (pill) and the bands (rects),
        // so they always agree by construction.
        const flags = detectTrailBraking(window)
        let braking = 0
        let trail = 0
        for (let i = 0; i < window.length; i++) {
          if (window[i]!.brake >= TRAIL_BRAKE_MIN) braking++
          if (flags[i]) trail++
        }
        // brakingFrames === 0 → no braking in window. NaN is the right wire
        // signal here ("undefined ratio"); the client renders that as "—".
        const value = braking > 0 ? trail / braking : Number.NaN
        const bands = trailBrakingBands(flags).map(b => ({
          startMs: window[b.startIdx]!.timestampMs,
          endMs: window[b.endIdx]!.timestampMs
        }))
        return { value, bands }
      }
    })
  }
}

export const rollingTbPercent = new RollingTbPercent()
