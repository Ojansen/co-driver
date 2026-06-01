<script setup lang="ts">
import { EVENT_TYPE_LABELS, isEventType, type EventType } from '~/utils/event-types'
import { formatLap } from '~/utils/format'

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
  bestLapId: number | null
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

// Compare: pick the best laps you want to overlay. The compare page overlays
// every selected lap on the trace + track map; cap at the palette size so the
// legend stays legible (checking past the cap drops the oldest selection).
const MAX_COMPARE = 6
const selectedLapIds = ref<number[]>([])

function toggleSelected(lapId: number | null) {
  if (lapId == null) return
  const idx = selectedLapIds.value.indexOf(lapId)
  if (idx >= 0) {
    selectedLapIds.value.splice(idx, 1)
    return
  }
  selectedLapIds.value.push(lapId)
  if (selectedLapIds.value.length > MAX_COMPARE) selectedLapIds.value.shift()
}

function isSelected(lapId: number | null): boolean {
  return lapId != null && selectedLapIds.value.includes(lapId)
}

const canCompare = computed(() => selectedLapIds.value.length >= 2)

async function goCompare() {
  if (!canCompare.value) return
  // Selection order is the leaderboard order (fastest first); the first becomes
  // the reference, the second the focus.
  const laps = [...selectedLapIds.value]
  await navigateTo({
    path: `/events/${eventTypeKey}/${eventId}/compare`,
    query: { laps: laps.join(','), ref: laps[0]!, focus: laps[1]! }
  })
}

// Delete event
const cascadeSessions = computed(() => data.value?.sessions.length ?? 0)
const cascadeLaps = computed(() =>
  (data.value?.sessions ?? []).reduce((sum, s) => sum + (s.lapCount ?? 0), 0)
)

function onDeleted() {
  return navigateTo(`/events/${eventTypeKey}`)
}
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader :title="data?.event.name ?? ''">
      <template #eyebrow>
        <NuxtLink
          to="/events"
          class="hover:text-zinc-300"
        >
          Events
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <NuxtLink
          :to="`/events/${eventTypeKey}`"
          class="hover:text-zinc-300"
        >
          {{ EVENT_TYPE_LABELS[eventTypeKey] }}
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <span class="text-zinc-300">{{ data?.event.name }}</span>
      </template>
      <template #actions>
        <DeleteAction
          :url="`/api/events/${eventId}`"
          :title="`Delete event “${data?.event.name}”?`"
          label="Delete event"
          confirm-label="Delete event"
          variant="subtle"
          @deleted="onDeleted"
        >
          <p>
            Permanently remove this event and everything captured under it.
            <span class="text-zinc-300">Cannot be undone.</span>
          </p>
          <ul class="mt-3 space-y-1 text-xs text-zinc-300">
            <li>· {{ cascadeSessions }} session{{ cascadeSessions === 1 ? '' : 's' }}</li>
            <li>· {{ cascadeLaps }} lap{{ cascadeLaps === 1 ? '' : 's' }}</li>
          </ul>
        </DeleteAction>
        <button
          type="button"
          class="rounded-sm border border-green-500/40 bg-green-500/10 px-6 py-3 font-mono text-xs uppercase tracking-[0.3em] text-green-300 transition-colors hover:border-green-400/60 hover:bg-green-500/20"
          @click="startAndGoLive"
        >
          <span class="mr-2 inline-block h-2 w-2 align-middle rounded-full bg-green-400" />
          {{ isRecording ? 'Go to Live' : 'Start Recording' }}
        </button>
      </template>
    </PageHeader>

    <div
      v-if="lastError"
      class="mb-6 card-error p-3 font-mono text-xs text-red-300"
    >
      {{ lastError }}
    </div>

    <section v-if="data?.sessions?.length">
      <div class="mb-3 flex items-center justify-between">
        <div class="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          Leaderboard — {{ data.sessions.length }} session{{ data.sessions.length === 1 ? '' : 's' }}
        </div>
        <div class="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em]">
          <span class="text-zinc-500">
            {{ selectedLapIds.length }} selected
          </span>
          <button
            v-if="canCompare"
            type="button"
            class="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-amber-500/20"
            @click="goCompare"
          >
            Compare →
          </button>
        </div>
      </div>
      <table class="w-full border-separate border-spacing-y-1 font-mono text-sm">
        <thead>
          <tr class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <th class="px-3 py-2 text-left font-normal" />
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
            :class="isSelected(s.bestLapId) ? 'bg-amber-500/10 hover:bg-amber-500/15' : ''"
            @click="openSession(s.sessionId)"
          >
            <td
              class="rounded-l-md px-3 py-2"
              @click.stop
            >
              <input
                type="checkbox"
                class="h-3.5 w-3.5 cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-30"
                :checked="isSelected(s.bestLapId)"
                :disabled="s.bestLapId == null"
                :title="s.bestLapId == null ? 'No laps to compare' : 'Compare this session'"
                @change="toggleSelected(s.bestLapId)"
              >
            </td>
            <td class="px-3 py-2 text-zinc-400">
              {{ s.bestLapMs == null ? '—' : i + 1 }}
            </td>
            <td class="px-3 py-2 text-zinc-100">
              {{ formatLap(s.bestLapMs) }}
            </td>
            <td class="px-3 py-2 text-zinc-400">
              {{ s.lapCount }}
            </td>
            <td class="px-3 py-2 text-zinc-200">
              <span class="text-zinc-400">[{{ classForDisplay(s.piAtStart, s.carClass) }}]</span>
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
      class="card-dashed p-8 text-center font-mono text-sm text-zinc-500"
    >
      No recordings yet for this event. Hit Start Recording to capture your first run.
    </div>
  </main>
</template>
