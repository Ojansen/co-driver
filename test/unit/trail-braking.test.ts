import { describe, expect, it } from 'vitest'
import {
  detectTrailBraking,
  trailBrakingBands,
  summarizeTrailBraking
} from '../../app/utils/trail-braking'

interface DetectorFrame {
  timestampMs: number
  brake: number
  steer: number
}

/**
 * Build N frames at 60 Hz starting at t0, where each frame's brake and steer
 * are computed by `gen(i)`. Used by every test below.
 */
function genFrames(n: number, gen: (i: number) => { brake: number, steer: number }, t0 = 0, stepMs = 16): DetectorFrame[] {
  const out: DetectorFrame[] = []
  for (let i = 0; i < n; i++) {
    const g = gen(i)
    out.push({ timestampMs: t0 + i * stepMs, brake: g.brake, steer: g.steer })
  }
  return out
}

describe('detectTrailBraking', () => {
  it('returns all-false for empty input', () => {
    expect(detectTrailBraking([])).toEqual([])
  })

  it('rejects straight-line braking (no steer)', () => {
    const frames = genFrames(120, i => ({
      brake: i < 60 ? 0.8 - i * 0.005 : 0.2,
      steer: 0 // zero steering
    }))
    const flags = detectTrailBraking(frames)
    expect(flags.some(Boolean)).toBe(false)
  })

  it('rejects a pure turn with no braking', () => {
    const frames = genFrames(120, () => ({ brake: 0, steer: 0.5 }))
    const flags = detectTrailBraking(frames)
    expect(flags.some(Boolean)).toBe(false)
  })

  it('rejects steady-state braking + steering (no decay)', () => {
    const frames = genFrames(120, () => ({ brake: 0.5, steer: 0.4 }))
    const flags = detectTrailBraking(frames)
    expect(flags.some(Boolean)).toBe(false) // brake never decays
  })

  it('detects classic trail-brake: brake decay + concurrent steer', () => {
    // 2 s of frames. Brake starts at 0.8, decays linearly to 0.1 over the second half.
    // Steer starts at 0, ramps to 0.4 over the second half.
    const frames = genFrames(120, (i) => {
      if (i < 60) return { brake: 0.8, steer: 0 } // straight-line braking phase
      const t = (i - 60) / 60 // 0..1 over the turn-in phase
      return { brake: 0.8 - t * 0.7, steer: t * 0.4 }
    })
    const flags = detectTrailBraking(frames)
    const onCount = flags.filter(Boolean).length
    expect(onCount).toBeGreaterThan(20) // covers a meaningful chunk of the turn-in
  })

  it('keeps two close-but-separated events distinct', () => {
    // First event: frames 30-50 (brake decays during turn).
    // Brake-off and straighten for frames 51-70.
    // Second event: frames 71-95 (same shape).
    const frames = genFrames(140, (i) => {
      if (i >= 25 && i < 50) {
        const t = (i - 25) / 25
        return { brake: 0.8 - t * 0.6, steer: t * 0.5 }
      }
      if (i >= 51 && i < 70) return { brake: 0, steer: 0 } // off-brake straightaway
      if (i >= 71 && i < 95) {
        const t = (i - 71) / 24
        return { brake: 0.7 - t * 0.5, steer: t * 0.4 }
      }
      return { brake: 0, steer: 0 }
    })
    const flags = detectTrailBraking(frames)
    const bands = trailBrakingBands(flags)
    expect(bands.length).toBe(2)
  })

  it('debounces single-frame spikes', () => {
    // 120 frames of nothing; one isolated frame in the middle satisfies all
    // detection conditions but only for one frame.
    const frames = genFrames(120, () => ({ brake: 0, steer: 0 }))
    // Plant a fake brake history so the lookback would succeed for one frame.
    frames[40]!.brake = 0.6
    frames[41]!.brake = 0.6
    frames[60]!.brake = 0.2
    frames[60]!.steer = 0.3
    const flags = detectTrailBraking(frames)
    expect(flags.filter(Boolean).length).toBe(0) // single frame can't survive debounce
  })
})

describe('trailBrakingBands', () => {
  it('returns empty for all-false', () => {
    expect(trailBrakingBands([false, false, false])).toEqual([])
  })

  it('compacts contiguous runs', () => {
    const f = [false, true, true, false, true, false, true, true, true]
    expect(trailBrakingBands(f)).toEqual([
      { startIdx: 1, endIdx: 2 },
      { startIdx: 4, endIdx: 4 },
      { startIdx: 6, endIdx: 8 }
    ])
  })

  it('handles a run that touches the end', () => {
    expect(trailBrakingBands([false, true, true])).toEqual([{ startIdx: 1, endIdx: 2 }])
  })
})

describe('summarizeTrailBraking', () => {
  it('returns zeros for empty', () => {
    expect(summarizeTrailBraking([])).toEqual({
      brakingFrames: 0,
      trailBrakingFrames: 0,
      ratio: 0,
      events: 0
    })
  })

  it('ratio is trail-braking / total braking', () => {
    // 60 frames of straight-line braking + 60 frames of trail-braking
    // (brake decay + steer ramp). All 120 frames have brake ≥ 0.10.
    const frames = genFrames(120, (i) => {
      if (i < 60) return { brake: 0.8 - i * 0.005, steer: 0 } // braking straight
      const t = (i - 60) / 60
      return { brake: 0.5 - t * 0.4, steer: t * 0.5 }
    })
    const s = summarizeTrailBraking(frames)
    expect(s.brakingFrames).toBeGreaterThan(60)
    expect(s.trailBrakingFrames).toBeGreaterThan(0)
    expect(s.ratio).toBeGreaterThan(0)
    expect(s.ratio).toBeLessThan(1)
    expect(s.events).toBe(1)
  })

  it('no braking → ratio 0', () => {
    const frames = genFrames(60, () => ({ brake: 0, steer: 0.5 }))
    expect(summarizeTrailBraking(frames).ratio).toBe(0)
  })
})
