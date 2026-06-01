/**
 * Forza Horizon 6 adapter.
 *
 * Uses the shared Forza "Data Out" decoder (./horizon-cardash.ts), which routes
 * by packet length — so the port-5300 socket this binds decodes any Forza title
 * (Horizon or Motorsport), not just FH6. This file is just the id + transport
 * wrapper for the FH6 game id.
 */

import type { TelemetryAdapter } from './types'
import { decodeForzaDataOut } from './horizon-cardash'

export const fh6Adapter: TelemetryAdapter = {
  id: 'fh6',
  transport: { protocol: 'udp', defaultPort: 5300 },
  decode: decodeForzaDataOut
}
