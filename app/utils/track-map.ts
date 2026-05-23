/**
 * Track-map helpers. Pure transforms over decoded Telemetry frames into a
 * compact `TrackPoint[]` for rendering by `app/components/TrackMap.vue`.
 *
 * Forza world axes follow the engine convention: Y = up, X/Z = ground plane.
 * The top-down map plots (X, Z); the elevation strip plots Y vs lap.distance.
 */

import type { Telemetry } from '../../server/utils/decode'

export interface TrackPoint {
  /** world X — horizontal axis on the top-down map */
  x: number
  /** world Z — vertical axis on the top-down map (north on screen, after
   *  the world→SVG sign flip in `svgYFromWorldZ`) */
  z: number
  /** world Y — height, used by the elevation profile strip */
  y: number
  /** km/h at this frame (already converted by the decoder) */
  speed: number
  /** input snapshots for color-by-throttle / color-by-brake modes */
  throttle: number
  brake: number
  /** lap.distance for this frame — monotonic over a lap, used as elevation X-axis */
  distance: number
  /** NormalizedDrivingLine deviation, raw s8 (-128..127); null for blobs
   *  recorded before the decoder started reading it. */
  drivingLine: number | null
}

export interface TrackBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minY: number
  maxY: number
  minDistance: number
  maxDistance: number
}

export interface PointsOptions {
  /** Keep every nth frame. Default 4 → ~15 Hz from a 60 Hz feed. */
  stride?: number
}

/**
 * Build a downsampled TrackPoint[] from decoded Telemetry frames.
 *
 * Filters out frames at (0, 0) — the game emits those during loading screens
 * and at the very start before the car is positioned. The first valid frame
 * is always kept regardless of stride so the start marker has a place to sit.
 */
export function pointsFromFrames(frames: Telemetry[], opts?: PointsOptions): TrackPoint[] {
  const stride = Math.max(1, opts?.stride ?? 4)
  const out: TrackPoint[] = []
  let kept = 0
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!
    const px = f.position?.x ?? 0
    const pz = f.position?.z ?? 0
    if (px === 0 && pz === 0) continue
    // Always include the first valid point; then every stride-th after that.
    if (kept > 0 && kept % stride !== 0) {
      kept++
      continue
    }
    out.push({
      x: px,
      z: pz,
      y: f.position?.y ?? 0,
      speed: f.speedKmh,
      throttle: f.throttle,
      brake: f.brake,
      distance: f.lap?.distance ?? 0,
      drivingLine: typeof f.drivingLine === 'number' ? f.drivingLine : null
    })
    kept++
  }
  return out
}

/** Min/max sweep over a TrackPoint[]. Returns a zeroed bounds for empty input. */
export function boundsFromPoints(points: TrackPoint[]): TrackBounds {
  if (points.length === 0) {
    return {
      minX: 0, maxX: 0, minZ: 0, maxZ: 0,
      minY: 0, maxY: 0, minDistance: 0, maxDistance: 0
    }
  }
  const first = points[0]!
  let minX = first.x, maxX = first.x
  let minZ = first.z, maxZ = first.z
  let minY = first.y, maxY = first.y
  let minDistance = first.distance, maxDistance = first.distance
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
    if (p.distance < minDistance) minDistance = p.distance
    if (p.distance > maxDistance) maxDistance = p.distance
  }
  return { minX, maxX, minZ, maxZ, minY, maxY, minDistance, maxDistance }
}

/** Bounds covering every trace in a multi-lap set. Used to unify viewports. */
export function boundsFromTraces(traces: { points: TrackPoint[] }[]): TrackBounds {
  const all: TrackPoint[] = []
  for (const t of traces) for (const p of t.points) all.push(p)
  return boundsFromPoints(all)
}

/** Convert world Z (Forza ground-plane axis, Y = up) to SVG y. SVG y grows
 *  downward; without negation, a counter-clockwise world path renders
 *  clockwise. See Issue #4. */
export function svgYFromWorldZ(z: number): number {
  return -z
}

/** Inverse of `svgYFromWorldZ` — used when a screen-space click is
 *  reverse-mapped back to a world position (e.g. click-to-seek). */
export function worldZFromSvgY(y: number): number {
  return -y
}
