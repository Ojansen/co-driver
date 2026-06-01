import type { GameId } from '#shared/games'
import { f1Adapter } from './f1'
import { fh5Adapter } from './fh5'
import { fh6Adapter } from './fh6'
import { fmAdapter } from './fm'
import { smsUdpAdapter } from './sms-udp'
import { ams2Adapter } from './ams2'
import type { TelemetryAdapter } from './types'

export type { TelemetryAdapter } from './types'

/**
 * Registered inbound adapters, keyed by game id. Only games with a wired
 * decoder appear here; the registry in shared/games.ts can list a game as
 * selectable (frontend) before its adapter lands (`telemetry: false`).
 */
const ADAPTERS: Partial<Record<GameId, TelemetryAdapter>> = {
  fh6: fh6Adapter,
  fh5: fh5Adapter,
  fm: fmAdapter,
  f1: f1Adapter,
  pcars2: smsUdpAdapter,
  ams2: ams2Adapter
}

/**
 * Telemetry is ingested for *every* wired game at once: the listener binds each
 * adapter's UDP port and decodes packets on that port with that adapter (see
 * server/plugins/forza-listener.ts). Whichever game you launch simply streams
 * to its port — there's no server-side "active game" to select. The in-app game
 * switcher only changes what the frontend shows/gates, never what's decoded.
 */
export function getAdapter(id: GameId): TelemetryAdapter | undefined {
  return ADAPTERS[id]
}

/** Every wired adapter, for the listener to bind a socket per port. */
export function listAdapters(): TelemetryAdapter[] {
  return Object.values(ADAPTERS).filter(Boolean) as TelemetryAdapter[]
}
