<script setup lang="ts">
import { EVENT_TYPE_LABELS, EVENT_TYPE_ORDER, type EventType } from '~/utils/event-types'

interface EventRow {
  id: number
  name: string
  type: EventType
  createdAt: number | string
}

const { data: events } = await useFetch<EventRow[]>('/api/events', { default: () => [] })

const counts = computed<Record<EventType, number>>(() => {
  const c: Record<EventType, number> = {
    rally: 0, race: 0, street_race: 0, cross_country: 0, drag: 0, freeroam: 0
  }
  for (const e of events.value ?? []) c[e.type]++
  return c
})
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-10">
    <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      Events
    </div>
    <h1 class="mb-10 font-mono text-3xl text-zinc-100">
      Pick an event type
    </h1>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="type in EVENT_TYPE_ORDER"
        :key="type"
        :to="`/events/${type}`"
        class="group flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-zinc-600 hover:bg-zinc-900/60"
      >
        <div class="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 group-hover:text-zinc-400">
          {{ counts[type] }} event{{ counts[type] === 1 ? '' : 's' }}
        </div>
        <div class="font-mono text-2xl text-zinc-100">
          {{ EVENT_TYPE_LABELS[type] }}
        </div>
      </NuxtLink>
    </div>
  </main>
</template>
