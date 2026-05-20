<script setup lang="ts">
const { telemetry, connected, hasReceivedFrame } = useTelemetry()
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <header class="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/85 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-400">
        <div class="flex items-center gap-6">
          <NuxtLink
            to="/live"
            class="text-zinc-100 transition-colors hover:text-zinc-50"
          >
            forza-data
          </NuxtLink>
          <nav class="flex items-center gap-1">
            <NuxtLink
              to="/live"
              exact-active-class="border-zinc-600 bg-zinc-900 text-zinc-100"
              class="rounded-sm border border-transparent px-2.5 py-1 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
            >
              Live
            </NuxtLink>
            <NuxtLink
              to="/events"
              active-class="border-zinc-600 bg-zinc-900 text-zinc-100"
              class="rounded-sm border border-transparent px-2.5 py-1 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
            >
              Events
            </NuxtLink>
          </nav>
        </div>
        <div class="flex items-center gap-4">
          <RecBadge with-stop-button />
          <span class="flex items-center gap-2">
            <span
              class="inline-block h-2 w-2 rounded-full"
              :class="connected ? 'bg-green-400' : 'bg-zinc-600'"
            />
            {{ connected ? 'WS LINKED' : 'WS OFFLINE' }}
          </span>
          <span
            v-if="hasReceivedFrame && telemetry"
            class="tabular-nums text-zinc-500"
          >
            T+{{ (telemetry.timestampMs / 1000).toFixed(1) }}s
          </span>
        </div>
      </div>
    </header>
    <slot />
  </div>
</template>
