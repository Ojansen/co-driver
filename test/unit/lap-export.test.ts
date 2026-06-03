import { describe, expect, it } from 'vitest'
import { LAP_CHANNELS } from '../../server/utils/lap-channels'
import { BUNDLE_FORMAT, BUNDLE_VERSION, toBundle, toCsv, type LapMeta } from '../../server/utils/lap-export'
import { toLd } from '../../server/utils/ld-export'
import { encodeFrames, decodeFrames } from '../../server/utils/frames-codec'
import type { Telemetry, Quad } from '../../server/utils/decode'

function frame(i: number): Telemetry {
  const q = (b: number): Quad => ({ fl: b, fr: b + 0.1, rl: b + 0.2, rr: b + 0.3 })
  return {
    isRaceOn: true,
    timestampMs: 1000 + i * (1000 / 60), // t0 = 1000; Time column must rebase to 0
    rpm: 6000 + i, rpmMax: 8000, rpmIdle: 900,
    speedKmh: 140.25, power: 120000, torque: 320, boost: null,
    gear: 4, throttle: 0.5, brake: 0.25, clutch: 0, handBrake: 0, steer: -0.1,
    drivingLine: 5, aiBrakeDifference: -3,
    suspension: q(0.5), suspensionMeters: q(0.05), slipRatio: q(0.05), slipAngle: q(0.11), combinedSlip: q(0.11), tireTempC: q(85),
    wheelRotation: q(120), rumble: null, puddle: null,
    yaw: 0.12, pitch: 0.01, roll: 0.02,
    position: { x: 100 + i, y: 5, z: 200 + i },
    velocity: { x: 38, y: 0, z: 1 },
    acceleration: { x: 2, y: 0.1, z: 9.8 },
    angularVelocity: { x: 0, y: 0.27, z: 0 },
    car: { ordinal: 1234, class: 5, pi: 800, drivetrain: 2, cylinders: 8 },
    lap: { number: 1, racePosition: 1, current: i * 0.016, last: 0, best: 0, raceTime: i * 0.016, distance: i * 0.6 },
    fuel: 0.95, rawLength: 324
  }
}

const meta: LapMeta = {
  event: { name: 'Goliath', type: 'cross_country' },
  car: { ordinal: 1234, class: 5, displayName: 'Test Car' },
  build: { name: 'S2', settings: { tires: 'race' } },
  tune: { name: 'baseline', settings: { rear: 12 } },
  session: {
    tuneLabel: 'baseline', piAtStart: 800,
    startedAt: '2026-06-01T12:30:45.000Z', endedAt: null,
    buildSnapshot: null, tuneSnapshot: null
  },
  lap: { lapNumber: 2, timeMs: 91234 }
}

const frames = Array.from({ length: 5 }, (_, i) => frame(i))
const t0 = frames[0]!.timestampMs

describe('lap-channels', () => {
  it('Time channel is lap-relative seconds', () => {
    const time = LAP_CHANNELS[0]!
    expect(time.name).toBe('Time')
    expect(time.get(frames[0]!, t0)).toBe(0)
    expect(time.get(frames[2]!, t0)).toBeCloseTo(2 / 60, 6)
  })

  it('scales pedals 0..1 → 0..100 %', () => {
    const throttle = LAP_CHANNELS.find(c => c.name === 'Throttle')!
    expect(throttle.unit).toBe('%')
    expect(throttle.get(frames[0]!, t0)).toBe(50)
  })

  it('expands quads to four corner columns', () => {
    const names = LAP_CHANNELS.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['Susp FL', 'Susp FR', 'Susp RL', 'Susp RR']))
  })
})

describe('toCsv', () => {
  it('headers carry name + unit and one data row per frame', () => {
    const lines = toCsv(frames, t0).trimEnd().split('\r\n')
    expect(lines[0]).toContain('Time (s)')
    expect(lines[0]).toContain('Throttle (%)')
    expect(lines).toHaveLength(frames.length + 1) // header + N rows
    expect(lines[1]!.split(',')[0]).toBe('0') // first frame Time = 0
  })

  it('renders absent channels (boost) as empty fields', () => {
    const header = toCsv(frames, t0).split('\r\n')[0]!.split(',')
    const boostCol = header.findIndex(h => h.startsWith('Boost'))
    const firstRow = toCsv(frames, t0).split('\r\n')[1]!.split(',')
    expect(firstRow[boostCol]).toBe('')
  })
})

describe('toLd', () => {
  const HEAD_SIZE = 1762
  const EVENT_SIZE = 1154
  const CHAN_SIZE = 124
  const META_PTR = HEAD_SIZE + EVENT_SIZE

  const buf = toLd(frames, t0, meta)

  // Time is implicit; boost is all-null on these frames and gets dropped.
  const expectedChannels = LAP_CHANNELS
    .filter(c => c.name !== 'Time')
    .filter(c => frames.some(f => c.get(f, t0) != null))

  it('starts with the 0x40 ld marker and points at event/meta blocks', () => {
    expect(buf.readUInt32LE(0)).toBe(0x40)
    expect(buf.readUInt32LE(8)).toBe(META_PTR) // chann_meta_ptr
    expect(buf.readUInt32LE(36)).toBe(HEAD_SIZE) // event_ptr right after head
    expect(buf.readUInt32LE(86)).toBe(expectedChannels.length) // num_channels
  })

  it('drops the implicit Time channel and all-null channels (boost)', () => {
    const names: string[] = []
    for (let i = 0; i < expectedChannels.length; i++) {
      names.push(buf.toString('ascii', META_PTR + i * CHAN_SIZE + 32, META_PTR + i * CHAN_SIZE + 64).replace(/\0.*$/, ''))
    }
    expect(names).not.toContain('Time')
    expect(names).not.toContain('Boost')
    expect(names).toContain('Speed')
  })

  it('links channel metas as a doubly-linked list', () => {
    const last = expectedChannels.length - 1
    expect(buf.readUInt32LE(META_PTR + 0)).toBe(0) // first prev = 0
    expect(buf.readUInt32LE(META_PTR + 4)).toBe(META_PTR + CHAN_SIZE) // first next
    expect(buf.readUInt32LE(META_PTR + last * CHAN_SIZE + 4)).toBe(0) // last next = 0
  })

  it('writes float32 data contiguously per channel, stored == physical', () => {
    const n = frames.length
    const dataPtr = META_PTR + expectedChannels.length * CHAN_SIZE
    expect(buf.length).toBe(dataPtr + expectedChannels.length * n * 4)

    // Speed channel: every sample is the physical value (no scaling applied).
    const speedIdx = expectedChannels.findIndex(c => c.name === 'Speed')
    const speed0 = buf.readFloatLE(dataPtr + speedIdx * n * 4)
    expect(speed0).toBeCloseTo(140.25, 2)
  })
})

describe('toBundle', () => {
  it('round-trips the frames blob byte-for-byte (lossless, no re-encode)', () => {
    const blob = encodeFrames(frames)
    const bundle = toBundle(meta, blob.toString('base64'))

    expect(bundle.format).toBe(BUNDLE_FORMAT)
    expect(bundle.version).toBe(BUNDLE_VERSION)

    const lap = bundle.lap as { framesB64: string, lapNumber: number, timeMs: number }
    expect(lap.lapNumber).toBe(2)
    const back = Buffer.from(lap.framesB64, 'base64')
    expect(back.equals(blob)).toBe(true)
    expect(decodeFrames(back)).toEqual(decodeFrames(blob))
  })
})
