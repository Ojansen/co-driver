/**
 * Resample lap frames onto a fixed-distance grid so two laps can be compared
 * point-for-point on the same x-axis.
 *
 * Forza emits `lap.distance` (meters, monotonically increasing within a lap)
 * and `lap.current` (lap-relative seconds). Per-lap frame blobs hold one lap,
 * but their first frame's distance/time isn't necessarily zero — we normalize
 * by subtracting the first frame's values.
 */

export interface AlignFrame {
  throttle: number
  brake: number
  steer: number
  lap: {
    distance: number
    current: number
  }
}

export interface AlignedSeries {
  /** distance bucket centers in meters, from 0 (lap start) */
  distance: Float32Array
  throttle: Float32Array
  brake: Float32Array
  steer: Float32Array
  /** lap-relative elapsed time at this distance, in milliseconds */
  elapsedMs: Float32Array
}

const EMPTY: AlignedSeries = {
  distance: new Float32Array(0),
  throttle: new Float32Array(0),
  brake: new Float32Array(0),
  steer: new Float32Array(0),
  elapsedMs: new Float32Array(0)
}

export function alignByDistance(frames: AlignFrame[], step = 1): AlignedSeries {
  if (frames.length < 2) return EMPTY

  const d0 = frames[0]!.lap.distance
  const t0 = frames[0]!.lap.current * 1000
  const dMax = frames[frames.length - 1]!.lap.distance - d0
  if (dMax <= 0) return EMPTY

  const n = Math.floor(dMax / step) + 1
  const distance = new Float32Array(n)
  const throttle = new Float32Array(n)
  const brake = new Float32Array(n)
  const steer = new Float32Array(n)
  const elapsedMs = new Float32Array(n)

  let j = 0
  for (let i = 0; i < n; i++) {
    const d = i * step
    while (j < frames.length - 2 && (frames[j + 1]!.lap.distance - d0) < d) j++
    const a = frames[j]!
    const b = frames[j + 1]!
    const da = a.lap.distance - d0
    const db = b.lap.distance - d0
    const span = db - da
    const tFrac = span > 0 ? (d - da) / span : 0

    distance[i] = d
    throttle[i] = a.throttle + (b.throttle - a.throttle) * tFrac
    brake[i] = a.brake + (b.brake - a.brake) * tFrac
    steer[i] = a.steer + (b.steer - a.steer) * tFrac
    elapsedMs[i] = (a.lap.current * 1000 - t0) + ((b.lap.current - a.lap.current) * 1000) * tFrac
  }

  return { distance, throttle, brake, steer, elapsedMs }
}
