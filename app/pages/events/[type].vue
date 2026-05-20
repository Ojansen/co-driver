<script setup lang="ts">
import { EVENT_TYPE_LABELS, isEventType, type EventType } from '~/utils/event-types'

const route = useRoute()
const router = useRouter()

const typeParam = String(route.params.type ?? '')
if (!isEventType(typeParam)) {
  throw createError({ statusCode: 404, statusMessage: 'unknown event type' })
}
const eventTypeKey = typeParam as EventType

interface EventRow {
  id: number
  name: string
  type: EventType
  createdAt: number | string
}

const { data: events, refresh } = await useFetch<EventRow[]>('/api/events', {
  query: { type: eventTypeKey },
  default: () => []
})

const newName = ref('')
const creating = ref(false)
const errorMessage = ref<string | null>(null)

const PLACEHOLDERS: Record<EventType, string> = {
  race: 'e.g. Goliath',
  street_race: 'e.g. Cancun Street Circuit',
  rally: 'e.g. Sierra Nueva Sprint',
  cross_country: 'e.g. Quad Crossing',
  drag: 'e.g. Airfield 1/4 mile',
  freeroam: 'e.g. Mulege coastal run'
}
const placeholder = computed(() => PLACEHOLDERS[eventTypeKey])

async function createEvent() {
  const name = newName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  errorMessage.value = null
  try {
    const created = await $fetch<EventRow>('/api/events', {
      method: 'POST',
      body: { name, type: eventTypeKey }
    })
    newName.value = ''
    await refresh()
    await router.push(`/events/${eventTypeKey}/${created.id}`)
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    errorMessage.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'create failed'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <main class="mx-auto max-w-3xl px-6 py-10">
    <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <NuxtLink
        to="/events"
        class="hover:text-zinc-300"
      >
        Events
      </NuxtLink>
      <span class="mx-2 text-zinc-700">/</span>
      <span class="text-zinc-300">{{ EVENT_TYPE_LABELS[eventTypeKey] }}</span>
    </div>
    <h1 class="mb-8 font-mono text-3xl text-zinc-100">
      {{ EVENT_TYPE_LABELS[eventTypeKey] }}
    </h1>

    <section class="mb-8 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        New event
      </div>
      <form
        class="flex gap-2"
        @submit.prevent="createEvent"
      >
        <input
          v-model="newName"
          type="text"
          :placeholder="placeholder"
          class="flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          :disabled="creating"
        >
        <button
          type="submit"
          class="rounded-sm border border-zinc-700 bg-zinc-900 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-green-500/60 hover:text-green-300 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="creating || !newName.trim()"
        >
          {{ creating ? 'Creating…' : 'Create' }}
        </button>
      </form>
      <div
        v-if="errorMessage"
        class="mt-2 font-mono text-xs text-red-400"
      >
        {{ errorMessage }}
      </div>
    </section>

    <ul
      v-if="events && events.length"
      class="space-y-2"
    >
      <li
        v-for="ev in events"
        :key="ev.id"
      >
        <NuxtLink
          :to="`/events/${eventTypeKey}/${ev.id}`"
          class="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900/60"
        >
          <span class="font-mono text-lg text-zinc-100">{{ ev.name }}</span>
          <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            #{{ ev.id }}
          </span>
        </NuxtLink>
      </li>
    </ul>
    <div
      v-else
      class="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center font-mono text-sm text-zinc-500"
    >
      No {{ EVENT_TYPE_LABELS[eventTypeKey].toLowerCase() }} events yet. Create one above.
    </div>
  </main>
</template>
