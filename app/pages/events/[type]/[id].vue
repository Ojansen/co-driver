<script setup lang="ts">
import { EVENT_TYPE_LABELS, isEventType, type EventType } from '~/utils/event-types'

const route = useRoute()
const typeParam = String(route.params.type ?? '')
const idParam = Number(route.params.id)

if (!isEventType(typeParam) || !Number.isInteger(idParam) || idParam <= 0) {
  throw createError({ statusCode: 404, statusMessage: 'not found' })
}
const eventTypeKey = typeParam as EventType
const eventId = idParam

interface SessionRow {
  sessionId: number
  carId: number
  carOrdinal: number
  carClass: number
  carDisplayName: string | null
  tuneLabel: string | null
  piAtStart: number
  startedAt: number | string
  endedAt: number | string | null
  bestLapMs: number | null
  lapCount: number
}
interface EventDetail {
  event: { id: number, name: string, type: EventType, createdAt: number | string }
  sessions: SessionRow[]
}

const { data, error } = await useFetch<EventDetail>(`/api/events/${eventId}`)
if (error.value || !data.value) {
  throw createError({ statusCode: 404, statusMessage: 'event not found' })
}

const { startRecording, recording, lastError } = useRecording()
const isRecording = computed(() => recording.value.state === 'recording')

const CLASS_LETTERS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X', 'Y']
function carClassLetter(c: number): string {
  return CLASS_LETTERS[c] ?? '?'
}

function formatLap(ms: number | null): string {
  if (ms == null) return '—'
  const totalSeconds = ms / 1000
  const m = Math.floor(totalSeconds / 60)
  const s = (totalSeconds - m * 60).toFixed(3).padStart(6, '0')
  return `${m}:${s}`
}

function formatDate(d: number | string): string {
  const date = typeof d === 'string' ? new Date(d) : new Date(d * 1000)
  return date.toLocaleString()
}

async function startAndGoLive() {
  if (isRecording.value) {
    await navigateTo('/live')
    return
  }
  const ok = startRecording(eventId, null)
  if (!ok) return
  await navigateTo('/live')
}

function openSession(sessionId: number) {
  return navigateTo(`/events/${eventTypeKey}/${eventId}/${sessionId}`)
}
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-10">
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
      <span class="text-zinc-300">{{ data?.event.name }}</span>
    </div>

    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          {{ EVENT_TYPE_LABELS[eventTypeKey] }}
        </div>
        <h1 class="mt-1 font-mono text-3xl text-zinc-100">
          {{ data?.event.name }}
        </h1>
      </div>
      <button
        type="button"
        class="rounded-sm border border-green-500/40 bg-green-500/10 px-6 py-3 font-mono text-xs uppercase tracking-[0.3em] text-green-300 transition-colors hover:border-green-400/60 hover:bg-green-500/20"
        @click="startAndGoLive"
      >
        <span class="mr-2 inline-block h-2 w-2 align-middle rounded-full bg-green-400" />
        {{ isRecording ? 'Go to Live' : 'Start Recording' }}
      </button>
    </div>

    <div
      v-if="lastError"
      class="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300"
    >
      {{ lastError }}
    </div>

    <section v-if="data?.sessions?.length">
      <div class="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        Leaderboard — {{ data.sessions.length }} session{{ data.sessions.length === 1 ? '' : 's' }}
      </div>
      <table class="w-full border-separate border-spacing-y-1 font-mono text-sm">
        <thead>
          <tr class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <th class="px-3 py-2 text-left font-normal">
              #
            </th>
            <th class="px-3 py-2 text-left font-normal">
              Best lap
            </th>
            <th class="px-3 py-2 text-left font-normal">
              Laps
            </th>
            <th class="px-3 py-2 text-left font-normal">
              Car
            </th>
            <th class="px-3 py-2 text-left font-normal">
              PI
            </th>
            <th class="px-3 py-2 text-left font-normal">
              Tune
            </th>
            <th class="px-3 py-2 text-left font-normal">
              Date
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(s, i) in data.sessions"
            :key="s.sessionId"
            class="cursor-pointer bg-zinc-900/40 transition-colors hover:bg-zinc-900/70"
            @click="openSession(s.sessionId)"
          >
            <td class="rounded-l-md px-3 py-2 text-zinc-400">
              {{ s.bestLapMs == null ? '—' : i + 1 }}
            </td>
            <td class="px-3 py-2 text-zinc-100">
              {{ formatLap(s.bestLapMs) }}
            </td>
            <td class="px-3 py-2 text-zinc-400">
              {{ s.lapCount }}
            </td>
            <td class="px-3 py-2 text-zinc-200">
              <span class="text-zinc-400">[{{ carClassLetter(s.carClass) }}]</span>
              {{ s.carDisplayName ?? `#${s.carOrdinal}` }}
            </td>
            <td class="px-3 py-2 text-zinc-300">
              {{ s.piAtStart }}
            </td>
            <td class="px-3 py-2 text-zinc-300">
              {{ s.tuneLabel ?? '—' }}
            </td>
            <td class="rounded-r-md px-3 py-2 text-xs text-zinc-500">
              {{ formatDate(s.startedAt) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <div
      v-else
      class="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center font-mono text-sm text-zinc-500"
    >
      No recordings yet for this event. Hit Start Recording to capture your first run.
    </div>
  </main>
</template>
