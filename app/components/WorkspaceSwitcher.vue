<script setup lang="ts">
import type { GameId } from '#shared/games'

// Header workspace switcher: shows the active game and lets you hop to another
// without going back to the grid. A plain dropdown (onClickOutside to dismiss)
// keeps it free of any overlay-component API coupling. Non-telemetry games are
// shown but not selectable — they have no data to open.
const { gameId, game, games, setGame } = useGame()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const route = useRoute()

onClickOutside(root, () => {
  open.value = false
})
watch(() => route.fullPath, () => {
  open.value = false
})

async function pick(id: GameId) {
  setGame(id)
  open.value = false
  await navigateTo('/workspace')
}
</script>

<template>
  <div
    ref="root"
    class="relative"
  >
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-sm border border-zinc-700 bg-zinc-900/60 px-2 py-1 text-zinc-300 transition-colors hover:border-zinc-500"
      :aria-expanded="open"
      aria-haspopup="menu"
      aria-label="Switch workspace"
      @click="open = !open"
    >
      <UIcon
        name="i-lucide-layout-grid"
        class="size-3 text-zinc-500"
      />
      <span class="max-w-[12ch] truncate text-xs normal-case tracking-normal">{{ game.label }}</span>
      <UIcon
        name="i-lucide-chevrons-up-down"
        class="size-3 text-zinc-500"
      />
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 z-30 mt-1 w-56 rounded-md border border-zinc-800 bg-zinc-950/95 p-1.5 font-mono shadow-xl backdrop-blur"
    >
      <div class="px-1.5 pb-1 text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        Workspace
      </div>
      <button
        v-for="g in games"
        :key="g.id"
        type="button"
        role="menuitemradio"
        :aria-checked="gameId === g.id"
        :disabled="!g.telemetry"
        class="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        :class="gameId === g.id ? 'bg-green-500/10 text-green-300' : 'text-zinc-300 hover:bg-zinc-800/70'"
        @click="g.telemetry && pick(g.id)"
      >
        <span>{{ g.label }}</span>
        <UIcon
          v-if="gameId === g.id"
          name="i-lucide-check"
          class="size-3.5"
        />
        <span
          v-else-if="!g.telemetry"
          class="text-[9px] uppercase tracking-[0.15em] text-amber-400/80"
        >soon</span>
      </button>
      <div class="mt-1 border-t border-zinc-800 pt-1">
        <NuxtLink
          to="/"
          class="block rounded-sm px-2 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200"
          @click="open = false"
        >
          All workspaces →
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
