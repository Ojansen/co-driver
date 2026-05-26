import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Telemetry } from '../../server/utils/decode'
import { forzaBus, type MeasurementEvent } from '../../server/utils/forza-bus'
import { RollingTbPercent } from '../../server/utils/rolling-tb-percent'

interface FrameInput {
  brake: number
  steer: number
  timestampMs: number
  isRaceOn?: boolean
}

function makeFrame(opts: FrameInput): Telemetry {
  return {
    isRaceOn: opts.isRaceOn ?? true,
    timestampMs: opts.timestampMs,
    brake: opts.brake,
    steer: opts.steer,
    throttle: 0,
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
  // (We don't keep the instance around — the bus holds the reference.)
  void new RollingTbPercent()
  return { measurements }
}

beforeEach(() => {
  // Clear any listeners left over from the module-load singleton or prior
  // tests so each test starts with a known bus state.
  forzaBus.removeAllListeners('telemetry')
  forzaBus.removeAllListeners('measurement')
})

afterEach(() => {
  forzaBus.removeAllListeners('telemetry')
  forzaBus.removeAllListeners('measurement')
})

describe('RollingTbPercent', () => {
  it('emits at ~5 Hz cadence (one measurement per 12 frames at 60 Hz)', () => {
    const { measurements } = fresh()
    for (let i = 0; i < 24; i++) {
      forzaBus.emit('telemetry', makeFrame({ brake: 0, steer: 0, timestampMs: i * 16 }))
    }
    expect(measurements).toHaveLength(2)
  })

  it('value is NaN when the window has no qualifying braking', () => {
    const { measurements } = fresh()
    for (let i = 0; i < 12; i++) {
      forzaBus.emit('telemetry', makeFrame({ brake: 0, steer: 0, timestampMs: i * 16 }))
    }
    expect(measurements).toHaveLength(1)
    expect(measurements[0]!.value).toBeNaN()
  })

  it('reports the window bounds as the oldest/newest frame timestamps', () => {
    const { measurements } = fresh()
    for (let i = 0; i < 12; i++) {
      forzaBus.emit('telemetry', makeFrame({ brake: 0, steer: 0, timestampMs: 1000 + i * 16 }))
    }
    expect(measurements).toHaveLength(1)
    expect(measurements[0]!.startMs).toBe(1000)
    expect(measurements[0]!.endMs).toBe(1000 + 11 * 16)
    expect(measurements[0]!.name).toBe('tb_rolling')
  })

  it('skips frames where isRaceOn is false (window freezes during pause)', () => {
    const { measurements } = fresh()
    // 11 live frames — counter at 11, no emit yet.
    for (let i = 0; i < 11; i++) {
      forzaBus.emit('telemetry', makeFrame({ brake: 0, steer: 0, timestampMs: i * 16, isRaceOn: true }))
    }
    expect(measurements).toHaveLength(0)
    // 20 paused frames — must not advance the counter.
    for (let i = 11; i < 31; i++) {
      forzaBus.emit('telemetry', makeFrame({ brake: 0, steer: 0, timestampMs: i * 16, isRaceOn: false }))
    }
    expect(measurements).toHaveLength(0)
    // 1 more live frame → counter hits 12 → emit.
    forzaBus.emit('telemetry', makeFrame({ brake: 0, steer: 0, timestampMs: 31 * 16, isRaceOn: true }))
    expect(measurements).toHaveLength(1)
  })

  it('clears the window on a large backwards timestamp jump (race-to-race transition)', () => {
    const { measurements } = fresh()
    // 12 frames starting at t=10 000.
    for (let i = 0; i < 12; i++) {
      forzaBus.emit('telemetry', makeFrame({ brake: 0, steer: 0, timestampMs: 10_000 + i * 16 }))
    }
    expect(measurements).toHaveLength(1)
    expect(measurements[0]!.startMs).toBe(10_000)
    // Backwards jump well past the 1-second tolerance.
    for (let i = 0; i < 12; i++) {
      forzaBus.emit('telemetry', makeFrame({ brake: 0, steer: 0, timestampMs: 5000 + i * 16 }))
    }
    expect(measurements).toHaveLength(2)
    // Post-reset window starts at the new clock, not the stale one.
    expect(measurements[1]!.startMs).toBe(5000)
  })

  it('value reflects summarizeTrailBraking ratio for the window contents', () => {
    const { measurements } = fresh()
    // Classic trail-brake shape (mirrors trail-braking.test.ts:53-64): straight-
    // line brake at 0.8 for 60 frames, then brake decays 0.8 → 0.1 while steer
    // ramps 0 → 0.4 over the next 60 frames.
    for (let i = 0; i < 120; i++) {
      let brake: number
      let steer: number
      if (i < 60) {
        brake = 0.8
        steer = 0
      } else {
        const tFrac = (i - 60) / 60
        brake = 0.8 - tFrac * 0.7
        steer = tFrac * 0.4
      }
      forzaBus.emit('telemetry', makeFrame({ brake, steer, timestampMs: i * 16 }))
    }
    // 120 frames / 12 = 10 emits.
    expect(measurements).toHaveLength(10)
    const last = measurements[measurements.length - 1]!
    expect(last.value).toBeGreaterThan(0)
    expect(last.value).toBeLessThanOrEqual(1)
  })
})
