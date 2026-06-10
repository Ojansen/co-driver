/**
 * Active-game selection — the "workspace" the app is scoped to. The chosen game
 * drives frontend adaptation: which nav sections show (capability gating), the
 * workspace home, and which game recordings/sessions are tagged with.
 *
 * Backed by a COOKIE (not localStorage): the active game gates SSR-rendered
 * output (nav, workspace pages), so the server must see the same value the
 * client will — a localStorage-only selection mismatches on hydration. A cookie
 * is readable on both server and client, so SSR renders the correct workspace.
 *
 * The registry (shared/games.ts) is the source of truth; this composable just
 * holds the selection and exposes the strongly-typed current GameDef.
 */

import type { GameId } from '#shared/games'
import { DEFAULT_GAME_ID, GAMES, getGame, isGameId } from '#shared/games'

export function useGame() {
  const gameId = useCookie<GameId>('co-driver:game', {
    default: () => DEFAULT_GAME_ID,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365
  })

  // One-time migration from the pre-Phase-2 localStorage key. Removing the
  // legacy key makes this idempotent; only ever runs once per browser, and only
  // for users upgrading with a non-default game saved (a single hydration
  // adjustment on that first load — unavoidable, since localStorage is
  // client-only and can't inform the server render).
  if (import.meta.client) {
    const legacy = window.localStorage.getItem('co-driver:game')
    if (legacy) {
      if (isGameId(legacy)) gameId.value = legacy
      window.localStorage.removeItem('co-driver:game')
    }
  }

  // Guard against a stale/removed id lingering in the cookie.
  if (!isGameId(gameId.value)) gameId.value = DEFAULT_GAME_ID

  const game = computed(() => getGame(gameId.value))
  const capabilities = computed(() => game.value.capabilities)

  function setGame(id: GameId): void {
    gameId.value = id
  }

  return { gameId, game, capabilities, games: GAMES, setGame }
}
