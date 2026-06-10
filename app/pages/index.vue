<script setup lang="ts">
import { relativeDate } from '~/utils/format'
import type { GameId } from '#shared/games'

useHead({ title: 'Workspaces · co-driver' })

// The game grid IS the workspace picker: each game is its own workspace (its
// cars, tracks and recorded sessions). Picking one scopes the whole app.
const { games, setGame } = useGame()

interface GameSummary {
  gameId: GameId
  sessionCount: number
  carCount: number
  lastAt: string | null
}
const { data: summary } = await useFetch<GameSummary[]>('/api/games/summary', { default: () => [] })

const byGame = computed(() => {
  const m = new Map<string, GameSummary>()
  for (const s of summary.value ?? []) m.set(s.gameId, s)
  return m
})

async function openWorkspace(id: GameId) {
  setGame(id)
  await navigateTo('/workspace')
}
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader title="Choose a workspace">
      <template #eyebrow>
        co-driver
      </template>
      <template #intro>
        Each game is its own workspace — its cars, tracks and recorded sessions.
        Pick one to analyse and learn. Tuning &amp; car building are Forza Horizon
        only; telemetry, recording, replay &amp; compare work everywhere.
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <template
        v-for="g in games"
        :key="g.id"
      >
        <!-- Telemetry-ready games open their workspace. -->
        <button
          v-if="g.telemetry"
          type="button"
          class="group flex flex-col gap-2 card p-6 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900/60"
          @click="openWorkspace(g.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-2xl text-zinc-100">{{ g.label }}</span>
            <span
              v-if="g.capabilities.tuning"
              class="rounded-sm bg-green-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-green-300"
            >tuning</span>
          </div>
          <div class="font-mono text-[11px] text-zinc-400 tabular-nums">
            <template v-if="byGame.get(g.id)">
              {{ byGame.get(g.id)!.sessionCount }} session{{ byGame.get(g.id)!.sessionCount === 1 ? '' : 's' }}
              · {{ byGame.get(g.id)!.carCount }} car{{ byGame.get(g.id)!.carCount === 1 ? '' : 's' }}
            </template>
            <template v-else>
              <span class="text-zinc-600">No sessions yet</span>
            </template>
          </div>
          <div
            v-if="byGame.get(g.id)?.lastAt"
            class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600 group-hover:text-zinc-500"
          >
            last driven {{ relativeDate(byGame.get(g.id)!.lastAt) }}
          </div>
        </button>

        <!-- Games without a wired decoder yet: shown, but not enterable. -->
        <div
          v-else
          class="flex cursor-not-allowed flex-col gap-2 card p-6 opacity-60"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-2xl text-zinc-400">{{ g.label }}</span>
            <span class="rounded-sm bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400/80">
              telemetry soon
            </span>
          </div>
          <div class="font-mono text-[11px] text-zinc-600">
            decoder not wired yet
          </div>
        </div>
      </template>
    </div>
  </main>
</template>
