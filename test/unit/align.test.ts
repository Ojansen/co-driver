import { describe, expect, it } from 'vitest'
import { alignByDistance, type AlignFrame } from '../../app/utils/align'

function constantSpeedLap(speedMps: number, distM: number, sampleHz = 60): AlignFrame[] {
  const dt = 1 / sampleHz
  const out: AlignFrame[] = []
  for (let t = 0; t * speedMps <= distM; t += dt) {
    out.push({
      throttle: 1,
      brake: 0,
      steer: 0,
      lap: { distance: 1000 + t * speedMps, current: t } // distance starts at 1000 m to verify normalization
    })
  }
  return out
}

describe('alignByDistance', () => {
  it('returns empty series for too-few frames', () => {
    const out = alignByDistance([], 1)
    expect(out.distance.length).toBe(0)
    expect(out.elapsedMs.length).toBe(0)
  })

  it('returns empty series when distance has no range', () => {
    const flat: AlignFrame[] = [
      { throttle: 0, brake: 0, steer: 0, lap: { distance: 50, current: 0 } },
      { throttle: 0, brake: 0, steer: 0, lap: { distance: 50, current: 0.5 } }
    ]
    expect(alignByDistance(flat, 1).distance.length).toBe(0)
  })

  it('normalizes distance to start at zero', () => {
    const frames = constantSpeedLap(10, 100)
    const aligned = alignByDistance(frames, 1)
    expect(aligned.distance[0]).toBe(0)
    expect(aligned.distance.at(-1)).toBeGreaterThanOrEqual(99)
    expect(aligned.distance.at(-1)).toBeLessThanOrEqual(100)
  })

  it('elapsed-time delta between two constant-speed laps matches expected', () => {
    // Lap A at 10 m/s and lap B at 12 m/s, both 1000 m.
    // Lap A finishes in 100s, lap B in ~83.33s. Delta at end ≈ −16,667 ms.
    const lapA = constantSpeedLap(10, 1000)
    const lapB = constantSpeedLap(12, 1000)
    const a = alignByDistance(lapA, 1)
    const b = alignByDistance(lapB, 1)
    const sharedLen = Math.min(a.elapsedMs.length, b.elapsedMs.length)
    expect(sharedLen).toBeGreaterThan(900)
    const finalDelta = b.elapsedMs[sharedLen - 1]! - a.elapsedMs[sharedLen - 1]!
    // B is faster, so finalDelta is negative.
    expect(finalDelta).toBeLessThan(-16000)
    expect(finalDelta).toBeGreaterThan(-17200)
  })

  it('linearly interpolates throttle between adjacent frames', () => {
    // Two frames straddling distance bucket 5m: A at 0m/throttle=0, B at 10m/throttle=1.
    const frames: AlignFrame[] = [
      { throttle: 0, brake: 0, steer: 0, lap: { distance: 0, current: 0 } },
      { throttle: 1, brake: 0, steer: 0, lap: { distance: 10, current: 1 } }
    ]
    const out = alignByDistance(frames, 1)
    // bucket 5 should be ~halfway between 0 and 1
    expect(out.throttle[5]).toBeCloseTo(0.5, 3)
    // elapsedMs at bucket 5 should be ~0.5s = 500 ms (linear time vs distance at constant speed)
    expect(out.elapsedMs[5]).toBeCloseTo(500, 1)
  })

  it('produces monotonically non-decreasing elapsedMs', () => {
    const frames = constantSpeedLap(15, 500)
    const out = alignByDistance(frames, 2)
    for (let i = 1; i < out.elapsedMs.length; i++) {
      expect(out.elapsedMs[i]!).toBeGreaterThanOrEqual(out.elapsedMs[i - 1]!)
    }
  })
})
