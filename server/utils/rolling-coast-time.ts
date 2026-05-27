/**
 * Rolling coast-time % — fraction of the last 30 s spent coasting through a
 * corner (off both pedals while still turning), broadcast at ~5 Hz.
 *
 * Definition (verbatim from WISHLIST.md):
 *   throttle < 0.05 AND brake < 0.05 AND |steer| > 0.1
 *
 * The steer filter is what makes this a *measurement* and not just a
 * single-channel aggregate: it picks out "coasting through a corner"
 * specifically, vs. "lifted off everything on a straightaway" (which the
 * trace strip already shows directly via the throttle/brake lines both
 * sitting at zero).
 *
 * Window hygiene (isRaceOn gate, clock reset, trim, emit cadence) lives in
 * RollingMeasurement.
 */

import { RollingMeasurement } from './rolling-window'

const THROTTLE_MAX = 0.05
const BRAKE_MAX = 0.05
const STEER_MIN = 0.1

export class RollingCoastTime extends RollingMeasurement<{ throttle: number, brake: number, steer: number }> {
  constructor() {
    super({
      name: 'time_coast',
      capture: t => ({ throttle: t.throttle, brake: t.brake, steer: t.steer }),
      reduce: (window) => {
        // Coast % is defined for any non-empty window; emit 0, not NaN, when
        // no frames qualify (the window is non-empty by construction here).
        if (window.length === 0) return 0
        let coastCount = 0
        for (const f of window) {
          if (f.throttle < THROTTLE_MAX && f.brake < BRAKE_MAX && Math.abs(f.steer) > STEER_MIN) coastCount++
        }
        return coastCount / window.length
      }
    })
  }
}

export const rollingCoastTime = new RollingCoastTime()
