import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Telemetry } from '../../server/utils/decode'
import { forzaBus, type MeasurementEvent } from '../../server/utils/forza-bus'
import { RollingPedalOverlap } from '../../server/utils/rolling-pedal-overlap'

interface FrameInput {
  throttle: number
  brake: number
  timestampMs: number
  isRaceOn?: boolean
}

function makeFrame(opts: FrameInput): Telemetry {
  return {
    isRaceOn: opts.isRaceOn ?? true,
    timestampMs: opts.timestampMs,
    throttle: opts.throttle,
    brake: opts.brake,
    steer: 0,
    rpm: 0,
    rpmMax: 0,
    torque: 0,
    power: 0,
    speed: 0,
    angularVelocity: { x: 0, y: 0, z: 0 },
    accelLat: 0,
    accelLong: 0,
    lap: { number: 0, racePosition: 1, current: 0, last: 0, best: 0, raceTime: 0, distance: 0 },
    car: { ordinal: 12345, class: 800, pi: 745, drivetrain: 0, cylinders: 4 }
  } as unknown as Telemetry
}

function fresh(): { measurements: MeasurementEvent[] } {
  const measurements: MeasurementEvent[] = []
  forzaBus.on('measurement', m => measurements.push(m))
  // Side-effect: subscribes a fresh listener to 'telemetry'.
  void new RollingPedalOverlap()
  return { measurements }
}

beforeEach(() => {
  forzaBus.removeAllListeners('telemetry')
  forzaBus.removeAllListeners('measurement')
})

afterEach(() => {
  forzaBus.removeAllListeners('telemetry')
  forzaBus.removeAllListeners('measurement')
})

describe('RollingPedalOverlap', () => {
  it('emits at ~5 Hz cadence (one measurement per 12 frames at 60 Hz)', () => {
    const { measurements } = fresh()
    for (let i = 0; i < 24; i++) {
      forzaBus.emit('telemetry', makeFrame({ throttle: 0.5, brake: 0.5, timestampMs: i * 16 }))
    }
    expect(measurements).toHaveLength(2)
    expect(measurements[0]!.name).toBe('pedal_overlap')
  })

  it('reports the window bounds as the oldest/newest frame timestamps', () => {
    const { measurements } = fresh()
    for (let i = 0; i < 12; i++) {
      forzaBus.emit('telemetry', makeFrame({ throttle: 0.5, brake: 0.5, timestampMs: 1000 + i * 16 }))
    }
    expect(measurements).toHaveLength(1)
    expect(measurements[0]!.startMs).toBe(1000)
    expect(measurements[0]!.endMs).toBe(1000 + 11 * 16)
  })

  it('value is 1.0 when both pedals are applied on every frame', () => {
    const { measurements } = fresh()
    for (let i = 0; i < 12; i++) {
      forzaBus.emit('telemetry', makeFrame({ throttle: 0.4, brake: 0.3, timestampMs: i * 16 }))
    }
    expect(measurements[0]!.value).toBe(1)
  })

  it('value is 0 (not NaN) when only one pedal is applied', () => {
    const { measurements } = fresh()
    // Throttle only — no overlap.
    for (let i = 0; i < 12; i++) {
      forzaBus.emit('telemetry', makeFrame({ throttle: 1.0, brake: 0, timestampMs: i * 16 }))
    }
    expect(measurements[0]!.value).toBe(0)
  })

  it('rejects frames where either pedal sits at or below the 0.05 noise floor', () => {
    const { measurements } = fresh()
    for (let i = 0; i < 12; i++) {
      // Brake at the threshold — not counted as overlap.
      forzaBus.emit('telemetry', makeFrame({ throttle: 0.8, brake: 0.05, timestampMs: i * 16 }))
    }
    expect(measurements[0]!.value).toBe(0)
  })

  it('value reflects the mix of overlapping and non-overlapping frames', () => {
    const { measurements } = fresh()
    // 60 frames both pedals, then 60 frames throttle-only → ratio 0.5 over the lot.
    for (let i = 0; i < 120; i++) {
      if (i < 60) {
        forzaBus.emit('telemetry', makeFrame({ throttle: 0.4, brake: 0.3, timestampMs: i * 16 }))
      } else {
        forzaBus.emit('telemetry', makeFrame({ throttle: 0.8, brake: 0, timestampMs: i * 16 }))
      }
    }
    expect(measurements).toHaveLength(10)
    const last = measurements[measurements.length - 1]!
    expect(last.value).toBeCloseTo(0.5, 2)
  })

  it('skips frames where isRaceOn is false (window freezes during pause)', () => {
    const { measurements } = fresh()
    for (let i = 0; i < 11; i++) {
      forzaBus.emit('telemetry', makeFrame({ throttle: 0.4, brake: 0.3, timestampMs: i * 16, isRaceOn: true }))
    }
    expect(measurements).toHaveLength(0)
    for (let i = 11; i < 31; i++) {
      forzaBus.emit('telemetry', makeFrame({ throttle: 0.4, brake: 0.3, timestampMs: i * 16, isRaceOn: false }))
    }
    expect(measurements).toHaveLength(0)
    forzaBus.emit('telemetry', makeFrame({ throttle: 0.4, brake: 0.3, timestampMs: 31 * 16, isRaceOn: true }))
    expect(measurements).toHaveLength(1)
  })

  it('clears the window on a large backwards timestamp jump (race-to-race transition)', () => {
    const { measurements } = fresh()
    for (let i = 0; i < 12; i++) {
      forzaBus.emit('telemetry', makeFrame({ throttle: 0.4, brake: 0.3, timestampMs: 10_000 + i * 16 }))
    }
    expect(measurements).toHaveLength(1)
    expect(measurements[0]!.startMs).toBe(10_000)
    for (let i = 0; i < 12; i++) {
      forzaBus.emit('telemetry', makeFrame({ throttle: 0.4, brake: 0.3, timestampMs: 5000 + i * 16 }))
    }
    expect(measurements).toHaveLength(2)
    expect(measurements[1]!.startMs).toBe(5000)
  })
})
