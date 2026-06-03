/**
 * Pure serializers for the text lap export formats. Kept out of the HTTP
 * endpoint so they're unit-testable without a request:
 *   - toCsv       generic, one row per frame, unit in the header — opens
 *                 anywhere (Excel, pandas, MyRaceLab)
 *   - toBundle    native co-driver envelope; carries the frames blob verbatim
 *                 (base64) so an import is lossless and re-encode-free
 * Raw JSON has no serializer here — the endpoint returns the decoded frames +
 * metadata object directly. The MoTeC i2 binary (.ld) export lives in
 * ld-export.ts.
 */
import type { Telemetry } from './decode'
import { LAP_CHANNELS } from './lap-channels'

export const BUNDLE_FORMAT = 'co-driver-lap'
export const BUNDLE_VERSION = 1

export interface LapMeta {
  event: { name: string, type: string }
  car: { ordinal: number, class: number, displayName: string | null }
  build: { name: string, settings: unknown } | null
  tune: { name: string, settings: unknown } | null
  session: {
    tuneLabel: string | null
    piAtStart: number
    startedAt: Date | number | string | null
    endedAt: Date | number | string | null
    buildSnapshot: unknown
    tuneSnapshot: unknown
  }
  lap: { lapNumber: number, timeMs: number }
}

/** Up to 4 decimals, trailing zeros stripped; empty string for absent channels. */
function num(v: number | null): string {
  if (v == null || Number.isNaN(v)) return ''
  return Number.parseFloat(v.toFixed(4)).toString()
}

const CRLF = '\r\n'

export function toCsv(frames: Telemetry[], t0: number): string {
  const header = LAP_CHANNELS.map(c => (c.unit ? `${c.name} (${c.unit})` : c.name)).join(',')
  const rows = [header]
  for (const f of frames) {
    rows.push(LAP_CHANNELS.map(c => num(c.get(f, t0))).join(','))
  }
  return rows.join(CRLF) + CRLF
}

export function toBundle(meta: LapMeta, framesB64: string): Record<string, unknown> {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    event: meta.event,
    car: meta.car,
    build: meta.build,
    tune: meta.tune,
    session: meta.session,
    lap: { lapNumber: meta.lap.lapNumber, timeMs: meta.lap.timeMs, framesB64 }
  }
}
