import { describe, expect, it } from 'vitest'
import {
  rideHeightFromFrames,
  computeRideHeightHistogram,
  rideHeightHistogram,
  rideHeightHistogramsForLap,
  DEFAULT_RH_BIN_EDGES
} from '../../app/utils/ride-height'
import type { Telemetry } from '../../server/utils/decode'

/** Minimal frame factory — only the normalized `suspension` field the
 *  ride-height module reads is populated; everything else defaults. */
function frame(opts: {
  fl?: number
  fr?: number
  rl?: number
  rr?: number
}): Telemetry {
  return {
    isRaceOn: true,
    timestampMs: 0,
    rpm: 0, rpmMax: 0, rpmIdle: 0,
    speedKmh: 0, power: 0, torque: 0, boost: 0,
    gear: 1, throttle: 0, brake: 0, clutch: 0, handBrake: 0, steer: 0,
    drivingLine: 0, aiBrakeDifference: 0,
    suspension: {
      fl: opts.fl ?? 0,
      fr: opts.fr ?? 0,
      rl: opts.rl ?? 0,
      rr: opts.rr ?? 0
    },
    suspensionMeters: { fl: 0, fr: 0, rl: 0, rr: 0 },
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

describe('rideHeightFromFrames', () => {
  it('reads the normalized travel of the requested corner', () => {
    const frames = [
      frame({ fl: 0.3, rr: 0.7 }),
      frame({ fl: 0.4, rr: 0.6 })
    ]
    expect(rideHeightFromFrames(frames, 'fl')).toEqual([0.3, 0.4])
    expect(rideHeightFromFrames(frames, 'rr')).toEqual([0.7, 0.6])
  })

  it('returns one sample per frame (no dt dropping)', () => {
    const frames = [frame({ fl: 0.5 }), frame({ fl: 0.5 }), frame({ fl: 0.5 })]
    expect(rideHeightFromFrames(frames, 'fl')).toHaveLength(3)
  })
})

describe('computeRideHeightHistogram', () => {
  it('returns null for empty input', () => {
    expect(computeRideHeightHistogram([])).toBeNull()
  })

  it('bins a mid-travel value into the band straddling it', () => {
    // 0.45 → bin [0.4, 0.5)
    const h = computeRideHeightHistogram([0.45])!
    const idx = h.binEdges.findIndex(e => e === 0.4)
    expect(h.counts[idx]!).toBe(1)
    expect(h.totalSamples).toBe(1)
  })

  it('clamps a bottomed value (>1) into the last bin', () => {
    const h = computeRideHeightHistogram([1.2])!
    expect(h.counts[h.counts.length - 1]!).toBe(1)
  })

  it('splits band shares at the droop/mid/compressed/bottoming boundaries', () => {
    // 0.1 → droop, 0.5 → mid, 0.8 → compressed, 0.98 → bottoming
    const h = computeRideHeightHistogram([0.1, 0.5, 0.8, 0.98])!
    expect(h.droopPct).toBeCloseTo(0.25, 5)
    expect(h.midPct).toBeCloseTo(0.25, 5)
    expect(h.compressedPct).toBeCloseTo(0.25, 5)
    expect(h.bottomingPct).toBeCloseTo(0.25, 5)
  })

  it('band shares sum to 1 within rounding', () => {
    const h = computeRideHeightHistogram([0.05, 0.2, 0.26, 0.6, 0.76, 0.9, 0.96, 0.99])!
    const sum = h.droopPct + h.midPct + h.compressedPct + h.bottomingPct
    expect(sum).toBeCloseTo(1, 5)
  })

  it('puts the boundary value 0.25 in droop, not mid', () => {
    // Bands use strict > for the upper edge, so 0.25 counts as droop.
    const h = computeRideHeightHistogram([0.25])!
    expect(h.droopPct).toBeCloseTo(1, 5)
    expect(h.midPct).toBeCloseTo(0, 5)
  })

  it('finds the peak bin where samples pile up', () => {
    const h = computeRideHeightHistogram([0.81, 0.82, 0.83, 0.84, 0.12])!
    // Most samples sit in [0.8, 0.9)
    expect(h.binEdges[h.peakBinIndex]!).toBeCloseTo(0.8, 5)
    expect(h.peakPct).toBeCloseTo(4 / 5, 5)
  })
})

describe('rideHeightHistogram', () => {
  it('reads a single corner straight from frames', () => {
    const frames = [frame({ fl: 0.9 }), frame({ fl: 0.96 })]
    const h = rideHeightHistogram(frames, 'fl')!
    expect(h.totalSamples).toBe(2)
    expect(h.bottomingPct).toBeCloseTo(0.5, 5)
  })
})

describe('rideHeightHistogramsForLap', () => {
  it('returns a histogram per corner', () => {
    const frames = [
      frame({ fl: 0.2, fr: 0.3, rl: 0.7, rr: 0.8 }),
      frame({ fl: 0.25, fr: 0.35, rl: 0.72, rr: 0.82 })
    ]
    const out = rideHeightHistogramsForLap(frames)
    expect(out).not.toBeNull()
    expect(out!.fl.totalSamples).toBe(2)
    expect(out!.rr.totalSamples).toBe(2)
  })

  it('returns null when there are no frames', () => {
    expect(rideHeightHistogramsForLap([])).toBeNull()
  })
})

describe('DEFAULT_RH_BIN_EDGES', () => {
  it('spans the full normalized travel range 0..1', () => {
    expect(DEFAULT_RH_BIN_EDGES[0]).toBe(0)
    expect(DEFAULT_RH_BIN_EDGES[DEFAULT_RH_BIN_EDGES.length - 1]).toBe(1)
  })
})
