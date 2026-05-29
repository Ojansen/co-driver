/**
 * Frame storage codec — columnar binary ("FZC1") with a JSON-legacy fallback.
 *
 * Why: a lap is stored as one gzipped blob and every analytics endpoint pulls
 * the whole thing and `JSON.parse`s it. Profiling showed JSON.parse is 78% of
 * decode and decode is 97% of a /tune request — and it's a *format* problem: a
 * frame is fully described by its numeric fields, so we store each field as a
 * contiguous column and skip parsing + object churn. Columnar f32 decode
 * benched ~22× faster than the JSON path, with the damper histogram
 * bit-for-bit identical.
 *
 * Format of the stored blob:
 *   - legacy:   a raw gzip stream (starts with 0x1f 0x8b) of JSON Telemetry[]
 *   - columnar: ASCII magic "FZC1" + gzip(payload)
 * `decodeFrames` sniffs the leading bytes, so old and new laps coexist with no
 * schema migration and no backfill. Only the recorder's write path changes.
 *
 * Precision: timestampMs is stored f64 (exact ms; it also exceeds f16/large-f32
 * integer range within a lap). Every other numeric field is f32 — which is
 * lossless for real telemetry (the FH6 UDP wire is f32) and what the perf win
 * is measured against. Nullable fields carry a per-frame presence bit so `null`
 * survives the round-trip rather than silently becoming 0.
 *
 * Schema is encoded by VERSION + a value-count sanity check. If the Telemetry
 * shape changes, bump VERSION and keep a decoder for the old one (legacy JSON
 * stays readable regardless).
 */
import { gzipSync, gunzipSync } from 'node:zlib'
import type { Telemetry, Quad } from './decode'

const MAGIC = Buffer.from('FZC1', 'ascii') // 0x46 0x5a 0x43 0x31
const VERSION = 1
const HEADER = 16 // [u32 n][u32 version][u32 valCount][u32 reserved]; 8-aligned for the f64 block

// ---- column schema ---------------------------------------------------------
// Each NumCol contributes `width` f32 lanes. `get` reads a frame into a value
// array (or null for an absent nullable field); `set` writes decoded values
// back onto a target object. Order here is the on-disk lane order — never
// reorder without bumping VERSION.
type Vec3 = { x: number, y: number, z: number }
type Decoded = Record<string, unknown>

interface NumCol {
  width: number
  nullable: boolean
  get: (f: Telemetry) => number[] | null
  set: (f: Decoded, v: number[] | null) => void
}

const top = (key: keyof Telemetry, nullable = false): NumCol => ({
  width: 1,
  nullable,
  get: (f) => {
    const v = (f as unknown as Record<string, number | null>)[key]
    return v == null ? null : [v]
  },
  set: (f, v) => {
    f[key] = v == null ? null : v[0]
  }
})

const nested = (group: 'car' | 'lap', key: string): NumCol => ({
  width: 1,
  nullable: false,
  get: f => [(f[group] as unknown as Record<string, number>)[key]!],
  set: (f, v) => {
    let g = f[group] as Record<string, number> | undefined
    if (!g) {
      g = {}
      f[group] = g
    }
    g[key] = v![0]!
  }
})

const quad = (key: keyof Telemetry, nullable = false): NumCol => ({
  width: 4,
  nullable,
  get: (f) => {
    const q = (f as unknown as Record<string, Quad | null>)[key]
    return q == null ? null : [q.fl, q.fr, q.rl, q.rr]
  },
  set: (f, v) => {
    f[key] = v == null ? null : { fl: v[0], fr: v[1], rl: v[2], rr: v[3] }
  }
})

const vec3 = (key: keyof Telemetry): NumCol => ({
  width: 3,
  nullable: false,
  get: (f) => {
    const o = (f as unknown as Record<string, Vec3>)[key]!
    return [o.x, o.y, o.z]
  },
  set: (f, v) => {
    f[key] = { x: v![0], y: v![1], z: v![2] }
  }
})

const NUM_COLS: NumCol[] = [
  // non-null scalars (top-level)
  top('rpm'), top('rpmMax'), top('rpmIdle'),
  top('speedKmh'), top('power'), top('torque'), top('boost'),
  top('gear'), top('throttle'), top('brake'), top('clutch'), top('handBrake'), top('steer'),
  top('yaw'), top('pitch'), top('roll'), top('rawLength'),
  // nested scalars
  nested('car', 'ordinal'), nested('car', 'class'), nested('car', 'pi'), nested('car', 'drivetrain'), nested('car', 'cylinders'),
  nested('lap', 'number'), nested('lap', 'racePosition'), nested('lap', 'current'), nested('lap', 'last'), nested('lap', 'best'), nested('lap', 'raceTime'), nested('lap', 'distance'),
  // nullable scalars
  top('drivingLine', true), top('aiBrakeDifference', true), top('fuel', true),
  // non-null quads
  quad('suspension'), quad('suspensionMeters'), quad('slipRatio'), quad('slipAngle'), quad('combinedSlip'), quad('tireTempC'),
  // nullable quads
  quad('wheelRotation', true), quad('puddle', true),
  // vec3
  vec3('position'), vec3('velocity'), vec3('acceleration'), vec3('angularVelocity')
]

const VAL_COUNT = NUM_COLS.reduce((s, c) => s + c.width, 0) // total f32 lanes per frame
const NULL_COLS = NUM_COLS.filter(c => c.nullable)

// Bitset layout (1 bit/frame each), fixed order:
//   0: isRaceOn   1: rumble-present   2..5: rumble fl/fr/rl/rr
//   6.. : presence for each nullable NumCol, in NUM_COLS order
const BS_RACE = 0
const BS_RUMBLE = 1
const BS_RUMBLE_BITS = 2 // .. 5
const BS_NULL_BASE = 6
const N_BITSETS = BS_NULL_BASE + NULL_COLS.length

// ---- encode ----------------------------------------------------------------
export function encodeFrames(frames: Telemetry[]): Buffer {
  const n = frames.length
  const bb = Math.ceil(n / 8) // bytes per bitset
  const f64Bytes = n * 8
  const f32Bytes = VAL_COUNT * n * 4
  const bitBytes = N_BITSETS * bb
  const size = HEADER + f64Bytes + f32Bytes + bitBytes

  // ArrayBuffer-backed → byteOffset 0, so f64/f32 views are correctly aligned.
  const ab = new ArrayBuffer(size)
  const payload = Buffer.from(ab)
  payload.writeUInt32LE(n, 0)
  payload.writeUInt32LE(VERSION, 4)
  payload.writeUInt32LE(VAL_COUNT, 8)
  payload.writeUInt32LE(0, 12)

  const ts = new Float64Array(ab, HEADER, n)
  for (let i = 0; i < n; i++) {
    ts[i] = frames[i]!.timestampMs
  }

  const vals = new Float32Array(ab, HEADER + f64Bytes, VAL_COUNT * n)
  let lane = 0
  for (const col of NUM_COLS) {
    for (let i = 0; i < n; i++) {
      const v = col.get(frames[i]!)
      for (let l = 0; l < col.width; l++) {
        vals[(lane + l) * n + i] = v == null ? 0 : v[l]!
      }
    }
    lane += col.width
  }

  const bits = new Uint8Array(ab, HEADER + f64Bytes + f32Bytes, bitBytes)
  const setBit = (idx: number, i: number): void => {
    bits[idx * bb + (i >> 3)]! |= 1 << (i & 7)
  }
  for (let i = 0; i < n; i++) {
    const f = frames[i]!
    if (f.isRaceOn) setBit(BS_RACE, i)
    if (f.rumble != null) {
      setBit(BS_RUMBLE, i)
      if (f.rumble.fl) setBit(BS_RUMBLE_BITS + 0, i)
      if (f.rumble.fr) setBit(BS_RUMBLE_BITS + 1, i)
      if (f.rumble.rl) setBit(BS_RUMBLE_BITS + 2, i)
      if (f.rumble.rr) setBit(BS_RUMBLE_BITS + 3, i)
    }
  }
  NULL_COLS.forEach((col, k) => {
    for (let i = 0; i < n; i++) {
      if (col.get(frames[i]!) != null) setBit(BS_NULL_BASE + k, i)
    }
  })

  return Buffer.concat([MAGIC, gzipSync(payload)])
}

// ---- decode (format-sniffing) ----------------------------------------------
export function decodeFrames(blob: Buffer): Telemetry[] {
  if (blob.length >= 2 && blob[0] === 0x1f && blob[1] === 0x8b) {
    // legacy: gzipped JSON
    return JSON.parse(gunzipSync(blob).toString('utf8')) as Telemetry[]
  }
  if (blob.length >= 4 && blob[0] === 0x46 && blob[1] === 0x5a && blob[2] === 0x43 && blob[3] === 0x31) {
    return decodeColumnar(gunzipSync(blob.subarray(MAGIC.length)))
  }
  throw new Error('frames-codec: unrecognized blob format')
}

function decodeColumnar(raw: Buffer): Telemetry[] {
  // gunzip output may sit at an unaligned byteOffset; copy into a fresh
  // ArrayBuffer so Float64Array/Float32Array views are valid.
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)
  const head = Buffer.from(ab)
  const n = head.readUInt32LE(0)
  const version = head.readUInt32LE(4)
  const valCount = head.readUInt32LE(8)
  if (version !== VERSION) throw new Error(`frames-codec: unsupported version ${version}`)
  if (valCount !== VAL_COUNT) throw new Error(`frames-codec: schema mismatch (blob ${valCount} lanes, code ${VAL_COUNT})`)

  const bb = Math.ceil(n / 8)
  const f64Bytes = n * 8
  const f32Bytes = VAL_COUNT * n * 4
  const ts = new Float64Array(ab, HEADER, n)
  const vals = new Float32Array(ab, HEADER + f64Bytes, VAL_COUNT * n)
  const bits = new Uint8Array(ab, HEADER + f64Bytes + f32Bytes, N_BITSETS * bb)
  const getBit = (idx: number, i: number): boolean => (bits[idx * bb + (i >> 3)]! & (1 << (i & 7))) !== 0

  const frames: Telemetry[] = new Array<Telemetry>(n)
  for (let i = 0; i < n; i++) {
    const f: Decoded = { timestampMs: ts[i], isRaceOn: getBit(BS_RACE, i) }
    f.rumble = getBit(BS_RUMBLE, i)
      ? { fl: getBit(BS_RUMBLE_BITS + 0, i), fr: getBit(BS_RUMBLE_BITS + 1, i), rl: getBit(BS_RUMBLE_BITS + 2, i), rr: getBit(BS_RUMBLE_BITS + 3, i) }
      : null

    let lane = 0
    let nullK = 0
    for (const col of NUM_COLS) {
      if (col.nullable) {
        const present = getBit(BS_NULL_BASE + nullK, i)
        nullK++
        if (!present) {
          col.set(f, null)
          lane += col.width
          continue
        }
      }
      const v = new Array<number>(col.width)
      for (let l = 0; l < col.width; l++) {
        v[l] = vals[(lane + l) * n + i]!
      }
      col.set(f, v)
      lane += col.width
    }
    frames[i] = f as unknown as Telemetry
  }
  return frames
}
