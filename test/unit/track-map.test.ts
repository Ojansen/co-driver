import { describe, expect, it } from 'vitest'
import {
  pointsFromFrames,
  boundsFromPoints,
  boundsFromTraces,
  svgYFromWorldZ,
  worldZFromSvgY
} from '../../app/utils/track-map'
import type { Telemetry } from '../../server/utils/decode'

/** Minimal Telemetry fixture — only the fields the track-map helper reads. */
function frame(overrides: Partial<Telemetry> & { x?: number, y?: number, z?: number, distance?: number } = {}): Telemetry {
  const { x = 0, y = 0, z = 0, distance = 0, ...rest } = overrides
  return {
    position: { x, y, z },
    speedKmh: 0,
    throttle: 0,
    brake: 0,
    lap: { number: 0, racePosition: 0, current: 0, last: 0, best: 0, raceTime: 0, distance },
    drivingLine: 0,
    ...rest
  } as Telemetry
}

describe('pointsFromFrames', () => {
  it('returns empty array for empty input', () => {
    expect(pointsFromFrames([])).toEqual([])
  })

  it('filters out frames at (0, 0) — loading/preroll frames', () => {
    const points = pointsFromFrames([
      frame({ x: 0, z: 0 }), // dropped
      frame({ x: 0, z: 0 }), // dropped
      frame({ x: 100, z: 50, speedKmh: 60 }),
      frame({ x: 110, z: 55, speedKmh: 70 })
    ], { stride: 1 })
    expect(points.length).toBe(2)
    expect(points[0]!.x).toBe(100)
  })

  it('honours stride — keeps every nth valid frame', () => {
    const frames = Array.from({ length: 12 }, (_, i) => frame({ x: i + 1, z: i + 1 }))
    const stride4 = pointsFromFrames(frames, { stride: 4 })
    // First valid kept; then every 4th. From 12 frames at stride 4:
    // kept indices among valid: 0, 4, 8 → 3 points
    expect(stride4.length).toBe(3)
    expect(stride4.map(p => p.x)).toEqual([1, 5, 9])
  })

  it('defaults stride to 4', () => {
    const frames = Array.from({ length: 9 }, (_, i) => frame({ x: i + 1, z: i + 1 }))
    const def = pointsFromFrames(frames)
    expect(def.length).toBe(3) // indices 0, 4, 8
  })

  it('preserves all readable fields per point', () => {
    const p = pointsFromFrames([
      frame({ x: 10, y: 12, z: 20, distance: 250, speedKmh: 88, throttle: 0.9, brake: 0.1, drivingLine: -42 })
    ], { stride: 1 })[0]!
    expect(p.x).toBe(10)
    expect(p.y).toBe(12)
    expect(p.z).toBe(20)
    expect(p.distance).toBe(250)
    expect(p.speed).toBe(88)
    expect(p.throttle).toBe(0.9)
    expect(p.brake).toBe(0.1)
    expect(p.drivingLine).toBe(-42)
  })

  it('drivingLine falls through as null when absent on the frame (old blobs)', () => {
    // Simulate an old blob by stripping drivingLine after construction
    const f = frame({ x: 1, z: 1 })
    delete (f as Partial<Telemetry>).drivingLine
    const p = pointsFromFrames([f], { stride: 1 })[0]!
    expect(p.drivingLine).toBeNull()
  })
})

describe('boundsFromPoints', () => {
  it('returns zeroed bounds for empty input', () => {
    const b = boundsFromPoints([])
    expect(b).toEqual({
      minX: 0, maxX: 0, minZ: 0, maxZ: 0,
      minY: 0, maxY: 0, minDistance: 0, maxDistance: 0
    })
  })

  it('computes min/max across all axes', () => {
    const points = pointsFromFrames([
      frame({ x: -10, y: 5, z: 0, distance: 0 }),
      frame({ x: 30, y: 12, z: -20, distance: 100 }),
      frame({ x: 15, y: 8, z: 40, distance: 250 })
    ], { stride: 1 })
    const b = boundsFromPoints(points)
    expect(b.minX).toBe(-10)
    expect(b.maxX).toBe(30)
    expect(b.minZ).toBe(-20)
    expect(b.maxZ).toBe(40)
    expect(b.minY).toBe(5)
    expect(b.maxY).toBe(12)
    expect(b.minDistance).toBe(0)
    expect(b.maxDistance).toBe(250)
  })
})

describe('boundsFromTraces', () => {
  it('unions bounds across multiple traces', () => {
    // Use non-(0,0) coords because the (0,0) filter would drop "real" points
    const a = pointsFromFrames([frame({ x: 1, y: 0, z: 1 }), frame({ x: 10, y: 0, z: 10 })], { stride: 1 })
    const b = pointsFromFrames([frame({ x: -5, y: 0, z: 20 }), frame({ x: 15, y: 0, z: 25 })], { stride: 1 })
    const u = boundsFromTraces([{ points: a }, { points: b }])
    expect(u.minX).toBe(-5)
    expect(u.maxX).toBe(15)
    expect(u.minZ).toBe(1)
    expect(u.maxZ).toBe(25)
  })

  it('handles empty traces gracefully', () => {
    expect(boundsFromTraces([])).toEqual({
      minX: 0, maxX: 0, minZ: 0, maxZ: 0,
      minY: 0, maxY: 0, minDistance: 0, maxDistance: 0
    })
  })
})

describe('svgYFromWorldZ — Issue #4 regression', () => {
  it('negates world Z so +Z points up on screen', () => {
    expect(svgYFromWorldZ(10)).toBe(-10)
    expect(svgYFromWorldZ(-7)).toBe(7)
  })

  it('round-trips with worldZFromSvgY', () => {
    for (const z of [0, 12.5, -3, 1000, -1000]) {
      expect(worldZFromSvgY(svgYFromWorldZ(z))).toBe(z)
    }
  })

  it('preserves rotation direction — a CCW world arc renders CCW visually', () => {
    // Three world points that form a left turn (CCW in the X-Z plane,
    // viewed from above): drive +Z, then curve toward -X. The 2D cross
    // product (b−a) × (c−b) is positive in world space → CCW.
    const a = { x: 0, z: 0 }
    const b = { x: 0, z: 10 }
    const c = { x: -5, z: 15 }
    const worldCross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)
    expect(worldCross).toBeGreaterThan(0)

    // Same points through the SVG mapping. SVG y grows downward, so a CCW
    // visual rotation has a NEGATIVE 2D cross in SVG coords. Before the
    // fix (no negation) this came out positive — that was Issue #4.
    const A = { x: a.x, y: svgYFromWorldZ(a.z) }
    const B = { x: b.x, y: svgYFromWorldZ(b.z) }
    const C = { x: c.x, y: svgYFromWorldZ(c.z) }
    const svgCross = (B.x - A.x) * (C.y - B.y) - (B.y - A.y) * (C.x - B.x)
    expect(svgCross).toBeLessThan(0)
  })
})
