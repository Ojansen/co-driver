/**
 * Forza Motorsport adapter (FM7 / FM 2023).
 *
 * Motorsport uses the same "Data Out" feature as Horizon, so it shares the
 * decoder and the UDP port (5300). The shared decoder routes by packet length:
 * Motorsport's Dash sits 12 bytes earlier than Horizon's (no gap) — 311 bytes
 * for FM7, 331 for FM 2023 (the extra per-tire-wear + track-ordinal fields are
 * ignored for now). See ./horizon-cardash.ts.
 *
 * Tuning stays off (capabilities in shared/games.ts): the tune stack is
 * FH6-calibrated and FM's setup conventions differ — telemetry/analysis only.
 */

import type { TelemetryAdapter } from './types'
import { decodeForzaDataOut } from './horizon-cardash'

export const fmAdapter: TelemetryAdapter = {
  id: 'fm',
  transport: { protocol: 'udp', defaultPort: 5300 },
  decode: decodeForzaDataOut
}
