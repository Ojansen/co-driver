/**
 * Shared gauge geometry. Angles are measured in degrees, clockwise from 12
 * o'clock, so a 270° sweep with a 90° bottom gap runs from -135° (lower-left)
 * to +135° (lower-right) — the classic round instrument layout.
 */

export interface GaugePoint { x: number, y: number }

/** Polar → cartesian. `angleDeg` is clockwise from straight up. */
export function polar(cx: number, cy: number, r: number, angleDeg: number): GaugePoint {
  const a = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
}

/** SVG arc path from t0 to t1 (clockwise) at radius r. Empty when degenerate. */
export function arcPath(cx: number, cy: number, r: number, t0: number, t1: number): string {
  if (Math.abs(t1 - t0) < 0.01) return ''
  const p0 = polar(cx, cy, r, t0)
  const p1 = polar(cx, cy, r, t1)
  const large = Math.abs(t1 - t0) > 180 ? 1 : 0
  const sweep = t1 >= t0 ? 1 : 0
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} ${sweep} ${p1.x} ${p1.y}`
}

export function clampUnit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
