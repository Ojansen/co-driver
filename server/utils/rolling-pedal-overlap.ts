/**
 * Rolling pedal-overlap % — fraction of the last 30 s where both pedals are
 * meaningfully applied at once, broadcast at ~5 Hz.
 *
 * Definition:
 *   throttle > 0.05 AND brake > 0.05
 *
 * This is the left-foot-braking signal — distinct from trail-braking (TB%),
 * which is brake-then-steer. Requiring *both* pedals is what makes it a
 * measurement rather than a single-channel aggregate; on a two-pedal setup
 * it sits near zero, so a sustained reading is itself the interpretation.
 * Pairs with the TB% strip on /live.
 *
 * Window hygiene (isRaceOn gate, clock reset, trim, emit cadence) lives in
 * RollingMeasurement.
 */

import { RollingMeasurement } from './rolling-window'

const THROTTLE_MIN = 0.05
const BRAKE_MIN = 0.05

export class RollingPedalOverlap extends RollingMeasurement<{ throttle: number, brake: number }> {
  constructor() {
    super({
      name: 'pedal_overlap',
      capture: t => ({ throttle: t.throttle, brake: t.brake }),
      reduce: (window) => {
        // Defined for any non-empty window; emit 0, not NaN, when no frames
        // qualify (the window is non-empty by construction here).
        if (window.length === 0) return 0
        let overlap = 0
        for (const f of window) {
          if (f.throttle > THROTTLE_MIN && f.brake > BRAKE_MIN) overlap++
        }
        return overlap / window.length
      }
    })
  }
}

export const rollingPedalOverlap = new RollingPedalOverlap()
