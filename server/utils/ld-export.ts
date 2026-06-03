/**
 * MoTeC i2 binary log (.ld) writer.
 *
 * Ported from gotzl/ldparser (https://github.com/gotzl/ldparser, ldparser.py,
 * the reverse-engineered reference for the format) — specifically its
 * `ldData.frompd()` / `write()` path. We follow that path verbatim:
 *
 *   [ ldHead 1762B ][ ldEvent 1154B ][ chan metas N*124B ][ data blocks ]
 *
 * No venue/vehicle sub-blocks are emitted (event.venue_ptr = 0), matching
 * frompd. Every channel is written as little-endian float32 with
 * shift=0, mul=1, scale=1, dec=0 so the stored word equals the physical value
 * (gotzl's encode is `((v/mul) - shift) * scale / 10^-dec`, which collapses to
 * `v`). i2 reconstructs each sample's time implicitly from the channel sample
 * rate — there is no per-sample timestamp and no "Time" channel.
 *
 * Unlike the CSV exporters this is a binary format, so absent channels can't be
 * left blank: we drop channels that are entirely null on this feed and write 0
 * for an individual null sample within an otherwise-present channel.
 */
import type { Telemetry } from './decode'
import { LAP_CHANNELS } from './lap-channels'
import type { LapMeta } from './lap-export'

// gotzl struct sizes (verified via struct.calcsize):
const HEAD_SIZE = 1762
const EVENT_SIZE = 1154
const CHAN_SIZE = 124
const META_PTR = HEAD_SIZE + EVENT_SIZE // 2916: first channel meta block
const EVENT_PTR = HEAD_SIZE // 1762

// ldChan strings are fixed-length, null-padded, ASCII.
const NAME_LEN = 32
const SHORT_LEN = 8
const UNIT_LEN = 12

/** Write an ASCII string into buf at offset, null-padded to len (truncates). */
function writeStr(buf: Buffer, offset: number, s: string, len: number): void {
  // strip to ASCII — i2 can't render °/² etc. in its fixed-width fields
  const ascii = s.replace(/[^\x20-\x7E]/g, '')
  buf.write(ascii.slice(0, len), offset, 'ascii')
}

/** MoTeC unit strings must be ASCII; map the non-ASCII units we emit. */
function asciiUnit(unit: string): string {
  return unit.replace('°C', 'C').replace('m/s²', 'm/s^2')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function asDate(v: Date | number | string | null): Date | null {
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === 'number') return new Date(v * 1000)
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function toLd(frames: Telemetry[], t0: number, meta: LapMeta): Buffer {
  // Implicit-time format: one fixed sample rate for all channels. Derive it the
  // same way the MoTeC CSV does, from frame count over lap duration.
  const last = frames.at(-1)
  const durationS = last ? (last.timestampMs - t0) / 1000 : 0
  const freq = frames.length > 1 && durationS > 0
    ? Math.max(1, Math.round((frames.length - 1) / durationS))
    : 60

  // Time is implicit in .ld — drop that channel. Drop channels that are
  // entirely null on this feed (e.g. boost/fuel on a feed without them).
  const channels = LAP_CHANNELS
    .filter(c => c.name !== 'Time')
    .filter(c => frames.some(f => c.get(f, t0) != null))

  const n = frames.length
  const dataPtr = META_PTR + channels.length * CHAN_SIZE
  const total = dataPtr + channels.length * n * 4
  const buf = Buffer.alloc(total)

  writeHead(buf, channels.length, meta)
  writeEvent(buf, meta)

  channels.forEach((chan, i) => {
    const metaPtr = META_PTR + i * CHAN_SIZE
    const prev = i === 0 ? 0 : META_PTR + (i - 1) * CHAN_SIZE
    const next = i === channels.length - 1 ? 0 : META_PTR + (i + 1) * CHAN_SIZE
    const chanData = dataPtr + i * n * 4

    writeChan(buf, metaPtr, {
      prev,
      next,
      dataPtr: chanData,
      dataLen: n,
      counter: 0x2ee1 + i,
      freq,
      name: chan.name,
      shortName: chan.name.slice(0, SHORT_LEN),
      unit: asciiUnit(chan.unit)
    })

    let off = chanData
    for (const f of frames) {
      const v = chan.get(f, t0)
      buf.writeFloatLE(v == null || Number.isNaN(v) ? 0 : v, off)
      off += 4
    }
  })

  return buf
}

function writeHead(buf: Buffer, numChannels: number, meta: LapMeta): void {
  const started = asDate(meta.session.startedAt)
  const date = started
    ? `${pad2(started.getUTCDate())}/${pad2(started.getUTCMonth() + 1)}/${started.getUTCFullYear()}`
    : ''
  const time = started
    ? `${pad2(started.getUTCHours())}:${pad2(started.getUTCMinutes())}:${pad2(started.getUTCSeconds())}`
    : ''

  buf.writeUInt32LE(0x40, 0) // ldmarker
  buf.writeUInt32LE(META_PTR, 8) // chann_meta_ptr
  buf.writeUInt32LE(META_PTR + numChannels * CHAN_SIZE, 12) // chann_data_ptr
  buf.writeUInt32LE(EVENT_PTR, 36) // event_ptr
  buf.writeUInt16LE(1, 64)
  buf.writeUInt16LE(0x4240, 66)
  buf.writeUInt16LE(0xf, 68)
  buf.writeUInt32LE(0x1f44, 70) // device serial
  writeStr(buf, 74, 'ADL', 8) // device type
  buf.writeUInt16LE(420, 82) // device version
  buf.writeUInt16LE(0xadb0, 84)
  buf.writeUInt32LE(numChannels, 86)
  writeStr(buf, 94, date, 16)
  writeStr(buf, 126, time, 16)
  writeStr(buf, 158, '', 64) // driver
  writeStr(buf, 222, meta.car.displayName ?? `Car ${meta.car.ordinal}`, 64) // vehicleid
  writeStr(buf, 350, meta.event.name, 64) // venue
  buf.writeUInt32LE(0xc81a4, 1502) // "pro logging" magic
  writeStr(buf, 1572, meta.session.tuneLabel ?? '', 64) // short comment
}

function writeEvent(buf: Buffer, meta: LapMeta): void {
  writeStr(buf, EVENT_PTR + 0, meta.event.name, 64) // name
  writeStr(buf, EVENT_PTR + 64, `Lap ${meta.lap.lapNumber}`, 64) // session
  writeStr(buf, EVENT_PTR + 128, meta.session.tuneLabel ?? '', 1024) // comment
  buf.writeUInt16LE(0, EVENT_PTR + 1152) // venue_ptr = 0 (no venue block)
}

interface ChanFields {
  prev: number
  next: number
  dataPtr: number
  dataLen: number
  counter: number
  freq: number
  name: string
  shortName: string
  unit: string
}

function writeChan(buf: Buffer, at: number, c: ChanFields): void {
  buf.writeUInt32LE(c.prev, at + 0)
  buf.writeUInt32LE(c.next, at + 4)
  buf.writeUInt32LE(c.dataPtr, at + 8)
  buf.writeUInt32LE(c.dataLen, at + 12)
  buf.writeUInt16LE(c.counter, at + 16)
  buf.writeUInt16LE(0x07, at + 18) // dtype_a: float
  buf.writeUInt16LE(4, at + 20) // dtype: float32 (4 bytes)
  buf.writeUInt16LE(c.freq, at + 22)
  buf.writeInt16LE(0, at + 24) // shift
  buf.writeInt16LE(1, at + 26) // mul
  buf.writeInt16LE(1, at + 28) // scale
  buf.writeInt16LE(0, at + 30) // dec_places
  writeStr(buf, at + 32, c.name, NAME_LEN)
  writeStr(buf, at + 64, c.shortName, SHORT_LEN)
  writeStr(buf, at + 72, c.unit, UNIT_LEN)
}
