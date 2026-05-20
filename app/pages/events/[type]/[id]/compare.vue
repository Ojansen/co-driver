<script setup lang="ts">
import { EVENT_TYPE_LABELS, isEventType, type EventType } from '~/utils/event-types'
import { formatLap, formatDelta } from '~/utils/format'
import type { Telemetry } from '../../../../../server/utils/decode'

const route = useRoute()
const typeParam = String(route.params.type ?? '')
const eventIdParam = Number(route.params.id)
const aParam = Number(route.query.a)
const bParam = Number(route.query.b)

if (
  !isEventType(typeParam)
  || !Number.isInteger(eventIdParam) || eventIdParam <= 0
  || !Number.isInteger(aParam) || aParam <= 0
  || !Number.isInteger(bParam) || bParam <= 0
  || aParam === bParam
) {
  throw createError({ statusCode: 404, statusMessage: 'invalid compare params' })
}
const eventTypeKey = typeParam as EventType
const eventId = eventIdParam
const lapAId = aParam
const lapBId = bParam

interface LapResponse {
  lapId: number
  lapNumber: number
  timeMs: number
  sessionId: number
  eventId: number
  tuneLabel: string | null
  piAtStart: number
  carOrdinal: number
  carClass: number
  carDisplayName: string | null
  frames: Telemetry[]
}

interface EventResponse {
  event: { id: number, name: string, type: EventType }
}

const [{ data: eventData }, { data: lapA, error: lapAError }, { data: lapB, error: lapBError }] = await Promise.all([
  useFetch<EventResponse>(`/api/events/${eventId}`),
  useFetch<LapResponse>(`/api/laps/${lapAId}/frames`),
  useFetch<LapResponse>(`/api/laps/${lapBId}/frames`)
])

if (lapAError.value || lapBError.value || !lapA.value || !lapB.value) {
  throw createError({ statusCode: 404, statusMessage: 'lap not found' })
}

if (lapA.value.eventId !== eventId || lapB.value.eventId !== eventId) {
  throw createError({ statusCode: 400, statusMessage: 'lap does not belong to this event' })
}

const CLASS_LETTERS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X', 'Y']
function carClassLetter(c: number): string {
  return CLASS_LETTERS[c] ?? '?'
}

function labelFor(l: LapResponse): string {
  return `${formatLap(l.timeMs)} · ${l.tuneLabel ?? 'untuned'}`
}

const netDelta = computed(() => (lapB.value?.timeMs ?? 0) - (lapA.value?.timeMs ?? 0))
const aAhead = computed(() => netDelta.value > 0)
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-10">
    <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <NuxtLink
        to="/events"
        class="hover:text-zinc-300"
      >
        Events
      </NuxtLink>
      <span class="mx-2 text-zinc-700">/</span>
      <NuxtLink
        :to="`/events/${eventTypeKey}`"
        class="hover:text-zinc-300"
      >
        {{ EVENT_TYPE_LABELS[eventTypeKey] }}
      </NuxtLink>
      <span class="mx-2 text-zinc-700">/</span>
      <NuxtLink
        :to="`/events/${eventTypeKey}/${eventId}`"
        class="hover:text-zinc-300"
      >
        {{ eventData?.event.name }}
      </NuxtLink>
      <span class="mx-2 text-zinc-700">/</span>
      <span class="text-zinc-300">Compare</span>
    </div>

    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          {{ EVENT_TYPE_LABELS[eventTypeKey] }} · {{ eventData?.event.name }}
        </div>
        <h1 class="mt-1 font-mono text-3xl text-zinc-100">
          Compare
        </h1>
      </div>
      <div
        class="rounded-lg border px-4 py-3 font-mono text-sm tabular-nums"
        :class="aAhead ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'"
      >
        <div class="text-[10px] uppercase tracking-[0.2em] opacity-70">
          {{ aAhead ? 'A faster by' : 'B faster by' }}
        </div>
        <div class="mt-0.5 text-xl">
          {{ formatDelta(netDelta) }} s
        </div>
      </div>
    </div>

    <section class="mb-6 grid grid-cols-1 gap-3 font-mono text-sm sm:grid-cols-2">
      <NuxtLink
        :to="`/events/${eventTypeKey}/${eventId}/${lapA?.sessionId}`"
        class="block rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900/70"
      >
        <div class="flex items-center justify-between">
          <span class="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <span
              class="inline-block h-1.5 w-3"
              style="background:#fafafa"
            />Lap A
          </span>
          <span class="text-[10px] text-zinc-500">Session #{{ lapA?.sessionId }}</span>
        </div>
        <div class="mt-2 text-2xl tabular-nums text-zinc-100">
          {{ formatLap(lapA?.timeMs) }}
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
          <span>
            <span class="text-zinc-500">[{{ carClassLetter(lapA?.carClass ?? 0) }}]</span>
            {{ lapA?.carDisplayName ?? `#${lapA?.carOrdinal}` }}
          </span>
          <span class="text-zinc-500">·</span>
          <span>PI {{ lapA?.piAtStart }}</span>
          <span class="text-zinc-500">·</span>
          <span>{{ lapA?.tuneLabel ?? 'untuned' }}</span>
        </div>
      </NuxtLink>

      <NuxtLink
        :to="`/events/${eventTypeKey}/${eventId}/${lapB?.sessionId}`"
        class="block rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900/70"
      >
        <div class="flex items-center justify-between">
          <span class="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <span
              class="inline-block h-1.5 w-3"
              style="background:#fbbf24"
            />Lap B
          </span>
          <span class="text-[10px] text-zinc-500">Session #{{ lapB?.sessionId }}</span>
        </div>
        <div class="mt-2 text-2xl tabular-nums text-zinc-100">
          {{ formatLap(lapB?.timeMs) }}
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
          <span>
            <span class="text-zinc-500">[{{ carClassLetter(lapB?.carClass ?? 0) }}]</span>
            {{ lapB?.carDisplayName ?? `#${lapB?.carOrdinal}` }}
          </span>
          <span class="text-zinc-500">·</span>
          <span>PI {{ lapB?.piAtStart }}</span>
          <span class="text-zinc-500">·</span>
          <span>{{ lapB?.tuneLabel ?? 'untuned' }}</span>
        </div>
      </NuxtLink>
    </section>

    <OverlayTraces
      v-if="lapA && lapB"
      :frames-a="lapA.frames"
      :frames-b="lapB.frames"
      :label-a="labelFor(lapA)"
      :label-b="labelFor(lapB)"
    />
  </main>
</template>
