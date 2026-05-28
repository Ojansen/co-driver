import { describe, expect, it } from 'vitest'
import {
  damperVelocityFromFrames,
  computeHistogram,
  damperHistogramsForLap,
  damperScatterFromFrames,
  damperScatterForLap,
  DEFAULT_BIN_EDGES
} from '../../app/utils/damper-velocity'
import type { Telemetry } from '../../server/utils/decode'

/** Minimal frame factory — only the fields the damper-velocity module
 *  reads are populated. Others are filled with zeros / defaults. The `sfl`…
 *  `srr` options set the normalized `suspension` position the scatter reads;
 *  they default to 0 so existing velocity/histogram tests are unaffected. */
function frame(opts: {
  ts: number
  fl?: number
  fr?: number
  rl?: number
  rr?: number
  sfl?: number
  sfr?: number
  srl?: number
  srr?: number
}): Telemetry {
  return {
    isRaceOn: true,
    timestampMs: opts.ts,
    rpm: 0, rpmMax: 0, rpmIdle: 0,
    speedKmh: 0, power: 0, torque: 0, boost: 0,
    gear: 1, throttle: 0, brake: 0, clutch: 0, handBrake: 0, steer: 0,
    drivingLine: 0, aiBrakeDifference: 0,
    suspension: {
      fl: opts.sfl ?? 0,
      fr: opts.sfr ?? 0,
      rl: opts.srl ?? 0,
      rr: opts.srr ?? 0
    },
    suspensionMeters: {
      fl: opts.fl ?? 0,
      fr: opts.fr ?? 0,
      rl: opts.rl ?? 0,
      rr: opts.rr ?? 0
    },
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    tireTempC: { fl: 0, fr: 0, rl: 0, rr: 0 },
    wheelRotation: { fl: 0, fr: 0, rl: 0, rr: 0 },
    rumble: { fl: false, fr: false, rl: false, rr: false },
    puddle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    yaw: 0, pitch: 0, roll: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    car: { ordinal: 1, class: 5, pi: 800, drivetrain: 2, cylinders: 8 },
    lap: { number: 1, racePosition: 1, current: 0, last: 0, best: 0, raceTime: 0, distance: 0 },
    fuel: 1,
    rawLength: 324
  }
}

describe('damperVelocityFromFrames', () => {
  it('computes velocity from delta / dt in mm/s', () => {
    // 1 mm compression over 16.67 ms (one 60Hz frame) → 60 mm/s
    const frames = [
      frame({ ts: 0, fl: 0.000 }),
      frame({ ts: 16.67, fl: 0.001 })
    ]
    const v = damperVelocityFromFrames(frames, 'fl')
    expect(v).toHaveLength(1)
    expect(v[0]!).toBeCloseTo(60, 0)
  })

  it('reports negative velocity for rebound', () => {
    const frames = [
      frame({ ts: 0, fl: 0.005 }),
      frame({ ts: 16.67, fl: 0.004 }) // 1 mm extension
    ]
    const v = damperVelocityFromFrames(frames, 'fl')
    expect(v[0]!).toBeCloseTo(-60, 0)
  })

  it('drops samples where dt exceeds the pause guard (100 ms)', () => {
    const frames = [
      frame({ ts: 0, fl: 0 }),
      frame({ ts: 200, fl: 0.010 }), // 200 ms gap — pause edge
      frame({ ts: 216.67, fl: 0.011 }) // back to 60 Hz
    ]
    const v = damperVelocityFromFrames(frames, 'fl')
    // First pair dropped (dt = 200 ms); second pair kept.
    expect(v).toHaveLength(1)
    expect(v[0]!).toBeCloseTo(60, 0)
  })

  it('drops samples with non-positive dt (clock anomalies)', () => {
    // Backward clock between frame 0 and 1; same timestamp between 1 and 2.
    // Both transitions should be dropped.
    const frames = [
      frame({ ts: 100, fl: 0 }),
      frame({ ts: 50, fl: 0.001 }),
      frame({ ts: 50, fl: 0.002 })
    ]
    const v = damperVelocityFromFrames(frames, 'fl')
    expect(v).toHaveLength(0)
  })

  it('reads the requested corner independently', () => {
    const frames = [
      frame({ ts: 0, fl: 0, fr: 0.002 }),
      frame({ ts: 16.67, fl: 0.001, fr: 0 })
    ]
    expect(damperVelocityFromFrames(frames, 'fl')[0]!).toBeCloseTo(60, 0)
    expect(damperVelocityFromFrames(frames, 'fr')[0]!).toBeCloseTo(-120, 0)
  })
})

describe('computeHistogram', () => {
  it('returns null for empty input', () => {
    expect(computeHistogram([])).toBeNull()
  })

  it('returns null for fewer than 2 bin edges', () => {
    expect(computeHistogram([1, 2, 3], [0])).toBeNull()
  })

  it('puts a value exactly on the 0 edge into the slow-bump bin', () => {
    // With DEFAULT_BIN_EDGES, the bin starting at 0 is [0, 25).
    // Value 0 should land there, not in the [-25, 0) bin to its left.
    const h = computeHistogram([0])!
    // Find the bin whose left edge is 0
    const zeroBinIdx = h.binEdges.findIndex(e => e === 0)
    expect(h.counts[zeroBinIdx]!).toBe(1)
    // The bin to the left (-25..0) should be empty.
    expect(h.counts[zeroBinIdx - 1]!).toBe(0)
  })

  it('clamps extreme values into the first / last bins rather than dropping', () => {
    const h = computeHistogram([-500, 500])!
    expect(h.counts[0]!).toBe(1) // -500 → first bin
    expect(h.counts[h.counts.length - 1]!).toBe(1) // 500 → last bin
    expect(h.totalSamples).toBe(2)
  })

  it('counts a symmetric synthetic input symmetrically', () => {
    // Six samples mirrored around 0 — each pair should land in symmetric bins.
    const h = computeHistogram([-100, -50, -10, 10, 50, 100])!
    expect(h.totalSamples).toBe(6)
    // Zone breakdown: 2 fast-bump (50, 100 — wait, 50 is the boundary)
    // 100 > 50 → fastBump; 50 → slowBump (boundary inclusive on the low side);
    // 10 → slowBump; -10 → slowRebound; -50 → slowRebound; -100 → fastRebound
    // Counts: fastBump=1, slowBump=2, slowReb=2, fastReb=1
    expect(h.fastBumpPct).toBeCloseTo(1 / 6, 5)
    expect(h.slowBumpPct).toBeCloseTo(2 / 6, 5)
    expect(h.slowReboundPct).toBeCloseTo(2 / 6, 5)
    expect(h.fastReboundPct).toBeCloseTo(1 / 6, 5)
  })

  it('finds the peak bin index correctly', () => {
    // Pile values into the slow-bump zone — peak should land there.
    const values = [5, 10, 15, 20, 22, 23, 24] // all in [0, 25)
    const h = computeHistogram(values)!
    const peakLeftEdge = h.binEdges[h.peakBinIndex]!
    expect(peakLeftEdge).toBe(0) // [0, 25) bin
    expect(h.peakPct).toBeCloseTo(1.0, 5)
  })

  it('zone-pct values sum to 1 within rounding', () => {
    const values = [-150, -80, -40, -10, 5, 15, 45, 90, 180]
    const h = computeHistogram(values)!
    const sum = h.fastBumpPct + h.slowBumpPct + h.slowReboundPct + h.fastReboundPct
    expect(sum).toBeCloseTo(1, 5)
  })
})

describe('damperHistogramsForLap', () => {
  it('returns a histogram per corner', () => {
    // 10 frames at 60 Hz, slight compression on FL, slight extension on RR.
    const frames: Telemetry[] = []
    for (let i = 0; i < 10; i++) {
      frames.push(frame({
        ts: i * 16.67,
        fl: i * 0.001,
        fr: 0,
        rl: 0,
        rr: -i * 0.001
      }))
    }
    const out = damperHistogramsForLap(frames)
    expect(out).not.toBeNull()
    expect(out!.fl.totalSamples).toBe(9)
    expect(out!.rr.totalSamples).toBe(9)
  })

  it('returns null when frames produce no usable samples (single frame)', () => {
    const frames = [frame({ ts: 0 })]
    expect(damperHistogramsForLap(frames)).toBeNull()
  })
})

describe('damperScatterFromFrames', () => {
  it('pairs the current frame position with the velocity at that frame', () => {
    // 1 mm compression over one 60 Hz frame → 60 mm/s; current pos = 0.5
    const frames = [
      frame({ ts: 0, fl: 0.000, sfl: 0.4 }),
      frame({ ts: 16.67, fl: 0.001, sfl: 0.5 })
    ]
    const pts = damperScatterFromFrames(frames, 'fl')
    expect(pts).toHaveLength(1)
    expect(pts[0]!.pos).toBeCloseTo(0.5, 5)
    expect(pts[0]!.vel).toBeCloseTo(60, 0)
  })

  it('applies the same pause-edge guard as the velocity calc', () => {
    const frames = [
      frame({ ts: 0, fl: 0, sfl: 0.3 }),
      frame({ ts: 200, fl: 0.010, sfl: 0.4 }), // 200 ms gap — dropped
      frame({ ts: 216.67, fl: 0.011, sfl: 0.5 })
    ]
    const pts = damperScatterFromFrames(frames, 'fl')
    expect(pts).toHaveLength(1)
    expect(pts[0]!.pos).toBeCloseTo(0.5, 5)
  })

  it('strides down to at most `cap` points, evenly spaced', () => {
    const frames: Telemetry[] = []
    for (let i = 0; i < 100; i++) {
      frames.push(frame({ ts: i * 16.67, fl: i * 0.0001, sfl: i / 100 }))
    }
    // 99 raw pairs, cap 10 → stride = ceil(99/10) = 10 → 10 points
    const pts = damperScatterFromFrames(frames, 'fl', 10)
    expect(pts.length).toBeLessThanOrEqual(10)
    expect(pts.length).toBeGreaterThan(0)
  })

  it('returns all points when under the cap', () => {
    const frames = [
      frame({ ts: 0, fl: 0, sfl: 0.1 }),
      frame({ ts: 16.67, fl: 0.001, sfl: 0.2 }),
      frame({ ts: 33.34, fl: 0.002, sfl: 0.3 })
    ]
    expect(damperScatterFromFrames(frames, 'fl', 1000)).toHaveLength(2)
  })
})

describe('damperScatterForLap', () => {
  it('returns points per corner', () => {
    const frames: Telemetry[] = []
    for (let i = 0; i < 10; i++) {
      frames.push(frame({
        ts: i * 16.67,
        fl: i * 0.001,
        rr: -i * 0.001,
        sfl: 0.5,
        srr: 0.6
      }))
    }
    const out = damperScatterForLap(frames)
    expect(out).not.toBeNull()
    expect(out!.fl).toHaveLength(9)
    expect(out!.rr).toHaveLength(9)
  })

  it('returns null when frames produce no usable points (single frame)', () => {
    expect(damperScatterForLap([frame({ ts: 0 })])).toBeNull()
  })
})

describe('DEFAULT_BIN_EDGES', () => {
  it('is symmetric around zero', () => {
    const edges = DEFAULT_BIN_EDGES
    for (let i = 0; i < edges.length; i++) {
      // Math equality, not Object.is — 0 vs -0 trips toBe() otherwise.
      expect(edges[i]! + edges[edges.length - 1 - i]!).toBe(0)
    }
  })

  it('includes a zero edge so bump and rebound bins are cleanly separated', () => {
    expect(DEFAULT_BIN_EDGES).toContain(0)
  })
})
