/**
 * Forza Horizon 5 adapter.
 *
 * Uses the shared Forza "Data Out" decoder (./horizon-cardash.ts) — same family
 * as FH4/FH6/Motorsport, routed by packet length. This file is just the id +
 * transport wrapper for the FH5 game id.
 */

import type { TelemetryAdapter } from './types'
import { decodeForzaDataOut } from './horizon-cardash'

export const fh5Adapter: TelemetryAdapter = {
  id: 'fh5',
  transport: { protocol: 'udp', defaultPort: 5300 },
  decode: decodeForzaDataOut
}
