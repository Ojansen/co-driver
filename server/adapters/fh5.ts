/**
 * Forza Horizon 5 adapter.
 *
 * FH5 emits the same Horizon "Data Out" Car Dash format as FH4/FH6 — byte for
 * byte — so it reuses the shared decoder in ./horizon-cardash.ts. This file is
 * only the id + transport wrapper that binds that decoder to the FH5 game id.
 */

import type { TelemetryAdapter } from './types'
import { decodeHorizonCarDash } from './horizon-cardash'

export const fh5Adapter: TelemetryAdapter = {
  id: 'fh5',
  transport: { protocol: 'udp', defaultPort: 5300 },
  decode: decodeHorizonCarDash
}
