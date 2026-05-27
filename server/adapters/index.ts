import type { GameId } from '../../shared/games'
import { DEFAULT_GAME_ID, isGameId } from '../../shared/games'
import { fh5Adapter } from './fh5'
import { fh6Adapter } from './fh6'
import type { TelemetryAdapter } from './types'

export type { TelemetryAdapter } from './types'

/**
 * Registered inbound adapters, keyed by game id. Only games with a wired
 * decoder appear here; the registry in shared/games.ts can list a game as
 * selectable (frontend) before its adapter lands (`telemetry: false`).
 */
const ADAPTERS: Partial<Record<GameId, TelemetryAdapter>> = {
  fh6: fh6Adapter,
  fh5: fh5Adapter
}

/**
 * The adapter the UDP host decodes with. The selected game lives in the
 * browser today, so the server defaults to FH6 (the only wired decoder) and
 * accepts a FORZA_GAME env override. When a second decoder lands, this is the
 * one spot to make adapter selection track the chosen game.
 */
export function getActiveAdapter(): TelemetryAdapter {
  const envGame = process.env.FORZA_GAME
  const id: GameId = isGameId(envGame) ? envGame : DEFAULT_GAME_ID
  return ADAPTERS[id] ?? fh6Adapter
}
