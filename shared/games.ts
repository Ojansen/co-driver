/**
 * Game registry — the core of the multi-game (ports & adapters) design.
 *
 * Every supported game is described once here: a stable id, a display label,
 * whether a live telemetry decoder (adapter) is wired, and its capability
 * flags. This registry is the single source of truth shared by the client
 * (nav gating + the game switcher) and the server (adapter selection).
 *
 * Adding a game is: one entry here, plus — for live data — one adapter under
 * `server/adapters/<id>.ts` mapping that game's wire format onto the canonical
 * `Telemetry` model.
 */

/** Every supported game id, as a runtime tuple. Single source of truth for the
 *  `GameId` union *and* the DB column enum (server/db/schema.ts imports this so
 *  cars/events/sessions are typed to the same set). Order is display order. */
export const GAME_IDS = ['fh6', 'fh5', 'fm', 'f1', 'pcars2', 'ams2'] as const

export type GameId = typeof GAME_IDS[number]

/**
 * Feature areas that vary by game. The tuning stack (builds, tunes, events,
 * dyno, upgrade, manual, plus session recording) is Forza-Horizon-specific
 * numerics, so it gates on `tuning`. Telemetry visualisation needs no
 * capability — any game with a wired decoder gets the live dashboards.
 */
export interface GameCapabilities {
  /** Builds / tunes / events / dyno / upgrade / manual + session recording. */
  tuning: boolean
}

export interface GameDef {
  id: GameId
  label: string
  /** A live telemetry decoder (server/adapters/<id>) is wired for this game.
   *  When false the game is selectable so the frontend adapts (nav gating),
   *  but live packets won't decode until its adapter lands. */
  telemetry: boolean
  capabilities: GameCapabilities
}

export const GAMES: readonly GameDef[] = [
  {
    id: 'fh6',
    label: 'Forza Horizon 6',
    telemetry: true,
    capabilities: { tuning: true }
  },
  {
    id: 'fh5',
    label: 'Forza Horizon 5',
    telemetry: true,
    // Telemetry/analysis-first. The tuning stack is FH6-calibrated (diff
    // ranges, caster, aero-balance slider, spring-slider display quirk); FH5's
    // conventions differ, so tuning stays off until verified against FH5.
    capabilities: { tuning: false }
  },
  {
    id: 'fm',
    label: 'Forza Motorsport',
    // Same "Data Out" feed as Horizon (shared decoder + port). Telemetry only:
    // the tune stack is FH6-calibrated and FM's setup conventions differ.
    telemetry: true,
    capabilities: { tuning: false }
  },
  {
    id: 'f1',
    label: 'F1 25 / F1 26',
    // EA/Codemasters native UDP feed (no agent). Telemetry-only: the tuning
    // stack is Forza-Horizon numerics and doesn't apply to F1.
    telemetry: true,
    capabilities: { tuning: false }
  },
  {
    id: 'pcars2',
    label: 'Project CARS 2',
    // Madness-engine "SMS UDP" feed (port 5606). Telemetry-only: the tune stack
    // is Forza-Horizon-specific. The decoder is shared with Automobilista 2.
    telemetry: true,
    capabilities: { tuning: false }
  },
  {
    id: 'ams2',
    label: 'Automobilista 2',
    // Same Madness "SMS UDP" feed as Project CARS 2 (set UDP mode = Project CARS 2
    // in-game); reuses the shared decoder on port 5606. Telemetry-only.
    telemetry: true,
    capabilities: { tuning: false }
  }
] as const

export const DEFAULT_GAME_ID: GameId = 'fh6'

export function getGame(id: GameId): GameDef {
  return GAMES.find(g => g.id === id) ?? GAMES[0]!
}

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value)
}
