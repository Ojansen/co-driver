/**
 * Forza Horizon 6 adapter.
 *
 * FH6 emits the shared Horizon "Data Out" Car Dash format — see
 * ./horizon-cardash.ts for the byte layout. This file is only the id +
 * transport wrapper that binds that decoder to the FH6 game id.
 */

import type { TelemetryAdapter } from './types'
import { decodeHorizonCarDash } from './horizon-cardash'

export const fh6Adapter: TelemetryAdapter = {
  id: 'fh6',
  transport: { protocol: 'udp', defaultPort: 5300 },
  decode: decodeHorizonCarDash
}
