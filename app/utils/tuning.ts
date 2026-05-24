/**
 * Tuning thresholds and color helpers for the corner view.
 * Hardcoded for v1; a settings panel in v2 will move these to user config.
 */

export const TIRE_TEMP_COLD_C = 80
export const TIRE_TEMP_HOT_C = 95

export const SUSPENSION_WARNING = 0.80
export const SUSPENSION_BOTTOMING = 0.95

export const SLIP_THRESHOLD = 0.10

/** Combined-slip magnitude is sqrt(slipRatio² + slipAngle²). >1.0 = past the
 * friction limit; ~0.8 is the working sweet-spot for a setup at the edge. */
export const COMB_WORKING = 0.5
export const COMB_NEAR_LIMIT = 0.8
export const COMB_OVER_LIMIT = 1.0

const GREEN = '#22c55e'
const TEAL = '#14b8a6'
const AMBER = '#f59e0b'
const RED = '#ef4444'
const BLUE = '#3b82f6'
const ZINC = '#52525b'

export function tempColor(c: number): string {
  if (c < TIRE_TEMP_COLD_C - 20) return BLUE
  if (c < TIRE_TEMP_COLD_C) return TEAL
  if (c <= TIRE_TEMP_HOT_C) return GREEN
  if (c <= TIRE_TEMP_HOT_C + 15) return AMBER
  return RED
}

export function suspColor(normalized: number): string {
  if (normalized > SUSPENSION_BOTTOMING) return RED
  if (normalized > SUSPENSION_WARNING) return AMBER
  return GREEN
}

export function slipColor(absSlip: number): string {
  if (absSlip > SLIP_THRESHOLD * 2) return RED
  if (absSlip > SLIP_THRESHOLD) return AMBER
  return ZINC
}

export function combColor(magnitude: number): string {
  if (magnitude > COMB_OVER_LIMIT) return RED
  if (magnitude > COMB_NEAR_LIMIT) return AMBER
  if (magnitude > COMB_WORKING) return TEAL
  return ZINC
}

/** FH6 gear u8 → human label. 0=R, 1-10=gears, 11=N (also seen mid-shift). */
export function gearLabel(g: number): string {
  if (g === 0) return 'R'
  if (g >= 11) return 'N'
  return String(g)
}
