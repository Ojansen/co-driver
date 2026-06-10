<script setup lang="ts">
import { EVENT_TYPE_LABELS, EVENT_TYPE_ORDER, type EventType } from '~/utils/event-types'

// Flat per-game event list: an event is a track/race {game, name}. This is the
// browse + create surface; rename/delete live on the event detail page. The
// Forza discipline `type` is optional metadata, surfaced as a filter for FH6.
const { gameId, game, capabilities } = useGame()
useHead({ title: () => `Events · ${game.value.label}` })

interface EventRow {
  id: number
  name: string
  type: EventType | null
  createdAt: number | string
  bestLapMs: number | null
  lastDrivenAt: string | number | null
}

const { data: events, refresh } = await useFetch<EventRow[]>('/api/events', {
  query: { gameId },
  default: () => []
})

async function createEvent(name: string) {
  const created = await $fetch<EventRow>('/api/events', {
    method: 'POST',
    body: { name, gameId: gameId.value }
  })
  await refresh()
  await navigateTo(`/events/${created.id}`)
}

// Discipline filter — only meaningful for FH6 (the one game that tags events),
// and only when some events actually carry a discipline.
const showFilter = computed(() => capabilities.value.tuning)
const disciplines = computed<EventType[]>(() => {
  const present = new Set<EventType>()
  for (const e of events.value ?? []) if (e.type) present.add(e.type)
  return EVENT_TYPE_ORDER.filter(t => present.has(t))
})
const activeFilter = ref<EventType | 'all'>('all')
const visibleEvents = computed(() => {
  const list = events.value ?? []
  return activeFilter.value === 'all' ? list : list.filter(e => e.type === activeFilter.value)
})
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader title="Events">
      <template #eyebrow>
        <NuxtLink
          to="/"
          class="hover:text-zinc-300"
        >
          Workspaces
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <NuxtLink
          to="/workspace"
          class="hover:text-zinc-300"
        >
          {{ game.label }}
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <span class="text-zinc-300">Events</span>
      </template>
      <template #intro>
        The tracks &amp; races you've logged in {{ game.label }}. Create one, then
        record against it from Live or the Quick record button.
      </template>
    </PageHeader>

    <CreateForm
      class="mb-8"
      title="New event"
      placeholder="e.g. Spa-Francorchamps"
      :submit="createEvent"
    />

    <div
      v-if="showFilter && disciplines.length"
      class="mb-4 flex flex-wrap gap-1.5"
    >
      <UButton
        label="All"
        size="xs"
        :color="activeFilter === 'all' ? 'primary' : 'neutral'"
        :variant="activeFilter === 'all' ? 'subtle' : 'outline'"
        class="font-mono text-[10px] uppercase tracking-[0.2em]"
        @click="activeFilter = 'all'"
      />
      <UButton
        v-for="d in disciplines"
        :key="d"
        :label="EVENT_TYPE_LABELS[d]"
        size="xs"
        :color="activeFilter === d ? 'primary' : 'neutral'"
        :variant="activeFilter === d ? 'subtle' : 'outline'"
        class="font-mono text-[10px] uppercase tracking-[0.2em]"
        @click="activeFilter = d"
      />
    </div>

    <ul
      v-if="visibleEvents.length"
      class="space-y-2"
    >
      <EventRowItem
        v-for="ev in visibleEvents"
        :key="ev.id"
        :ev="ev"
      />
    </ul>
    <UEmpty
      v-else
      icon="i-lucide-flag"
      title="No events yet"
      :description="`Create one above, then record against it in ${game.label}.`"
      class="card-dashed font-mono"
    />
  </main>
</template>
