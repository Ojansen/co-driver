<script setup lang="ts">
import { EVENT_TYPE_LABELS, isEventType, type EventType } from '~/utils/event-types'
import { formatLap } from '~/utils/format'
import type { Telemetry } from '../../../../../server/utils/decode'

const route = useRoute()
const typeParam = String(route.params.type ?? '')
const eventIdParam = Number(route.params.id)
const sessionIdParam = Number(route.params.sessionId)

if (
  !isEventType(typeParam)
  || !Number.isInteger(eventIdParam) || eventIdParam <= 0
  || !Number.isInteger(sessionIdParam) || sessionIdParam <= 0
) {
  throw createError({ statusCode: 404, statusMessage: 'not found' })
}
const eventTypeKey = typeParam as EventType
const eventId = eventIdParam
const sessionId = sessionIdParam

interface SessionRow {
  sessionId: number
  eventId: number
  eventName: string
  eventType: EventType
  carId: number
  carOrdinal: number
  carClass: number
  carDisplayName: string | null
  tuneLabel: string | null
  piAtStart: number
  startedAt: string
  endedAt: string | null
}
interface LapRow {
  id: number
  lapNumber: number
  timeMs: number
}
interface SessionDetail {
  session: SessionRow
  laps: LapRow[]
}

const { data, error } = await useFetch<SessionDetail>(`/api/sessions/${sessionId}`)
if (error.value || !data.value) {
  throw createError({ statusCode: 404, statusMessage: 'session not found' })
}

// Replay state
const selectedLapId = ref<number | null>(null)
const replayFrames = ref<Telemetry[] | null>(null)
const loadingFrames = ref(false)
const framesError = ref<string | null>(null)

// Inline tune-label editing
const editingTune = ref(false)
const tuneDraft = ref('')
const savingTune = ref(false)
const tuneError = ref<string | null>(null)

function startEditTune() {
  if (savingTune.value) return
  tuneDraft.value = data.value?.session.tuneLabel ?? ''
  tuneError.value = null
  editingTune.value = true
}

function cancelEditTune() {
  editingTune.value = false
  tuneDraft.value = ''
  tuneError.value = null
}

async function saveTune() {
  if (savingTune.value || !data.value) return
  savingTune.value = true
  tuneError.value = null
  const trimmed = tuneDraft.value.trim()
  const next = trimmed.length > 0 ? trimmed : null
  try {
    const updated = await $fetch<{ tuneLabel: string | null }>(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      body: { tuneLabel: next }
    })
    data.value.session.tuneLabel = updated.tuneLabel
    editingTune.value = false
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    tuneError.value = e.data?.statusMessage ?? e.message ?? 'save failed'
  } finally {
    savingTune.value = false
  }
}

async function selectLap(lapId: number) {
  if (loadingFrames.value) return
  framesError.value = null
  selectedLapId.value = lapId
  loadingFrames.value = true
  replayFrames.value = null
  try {
    const res = await $fetch<{ lapId: number, lapNumber: number, timeMs: number, frames: Telemetry[] }>(`/api/laps/${lapId}/frames`)
    replayFrames.value = res.frames
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    framesError.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'failed to load frames'
    selectedLapId.value = null
  } finally {
    loadingFrames.value = false
  }
}

const CLASS_LETTERS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X', 'Y']
function carClassLetter(c: number): string {
  return CLASS_LETTERS[c] ?? '?'
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return '—'
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}m ${sec.toString().padStart(2, '0')}s`
}

const bestLapMs = computed(() => {
  const laps = data.value?.laps ?? []
  if (laps.length === 0) return null
  return Math.min(...laps.map(l => l.timeMs))
})

// Delete session
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const cascadeLaps = computed(() => data.value?.laps.length ?? 0)

function openDelete() {
  deleteError.value = null
  deleteOpen.value = true
}

async function confirmDelete() {
  if (deleting.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
    deleteOpen.value = false
    await navigateTo(`/events/${eventTypeKey}/${eventId}`)
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    deleteError.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'delete failed'
    deleteOpen.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <main class="mx-auto max-w-[1600px] px-6 py-10">
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
        {{ data?.session.eventName }}
      </NuxtLink>
      <span class="mx-2 text-zinc-700">/</span>
      <span class="text-zinc-300">Session #{{ sessionId }}</span>
    </div>

    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          {{ EVENT_TYPE_LABELS[eventTypeKey] }} · {{ data?.session.eventName }}
        </div>
        <h1 class="mt-1 font-mono text-3xl text-zinc-100">
          Session #{{ sessionId }}
        </h1>
      </div>
      <button
        type="button"
        class="rounded-sm border border-red-500/40 bg-red-500/10 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.3em] text-red-300 transition-colors hover:border-red-400/60 hover:bg-red-500/20"
        @click="openDelete"
      >
        Delete session
      </button>
    </div>

    <div
      v-if="deleteError"
      class="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300"
    >
      {{ deleteError }}
    </div>

    <section class="mb-8 grid grid-cols-2 gap-3 font-mono text-sm sm:grid-cols-4">
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Car
        </div>
        <div class="mt-1 text-zinc-100">
          <span class="text-zinc-400">[{{ carClassLetter(data?.session.carClass ?? 0) }}]</span>
          {{ data?.session.carDisplayName ?? `#${data?.session.carOrdinal}` }}
        </div>
      </div>
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          PI · Tune
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-x-2 text-zinc-100">
          <span>{{ data?.session.piAtStart }}</span>
          <span class="text-zinc-500">·</span>
          <template v-if="!editingTune">
            <button
              type="button"
              class="rounded-sm text-left transition-colors hover:bg-zinc-800/60 hover:text-zinc-50"
              :title="data?.session.tuneLabel ? 'Click to edit tune label' : 'Click to set a tune label'"
              @click="startEditTune"
            >
              {{ data?.session.tuneLabel ?? '—' }}
            </button>
          </template>
          <template v-else>
            <input
              v-model="tuneDraft"
              type="text"
              autofocus
              :disabled="savingTune"
              placeholder="tune name"
              class="min-w-0 flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
              @keydown.enter.prevent="saveTune"
              @keydown.esc.prevent="cancelEditTune"
              @blur="saveTune"
            >
          </template>
        </div>
        <div
          v-if="tuneError"
          class="mt-1 text-[10px] text-red-400"
        >
          {{ tuneError }}
        </div>
      </div>
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Best lap
        </div>
        <div class="mt-1 text-zinc-100">
          {{ bestLapMs == null ? '—' : formatLap(bestLapMs) }}
          <span class="text-zinc-500 text-xs">· {{ data?.laps.length }} lap{{ data?.laps.length === 1 ? '' : 's' }}</span>
        </div>
      </div>
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Started · Duration
        </div>
        <div class="mt-1 text-zinc-100 text-xs">
          {{ formatDate(data?.session.startedAt ?? null) }}
        </div>
        <div class="text-zinc-500 text-xs">
          {{ formatDuration(data?.session.startedAt ?? '', data?.session.endedAt ?? null) }}
        </div>
      </div>
    </section>

    <section v-if="data?.laps?.length">
      <div class="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        Laps
      </div>
      <table class="w-full border-separate border-spacing-y-1 font-mono text-sm">
        <thead>
          <tr class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <th class="px-3 py-2 text-left font-normal">
              Lap
            </th>
            <th class="px-3 py-2 text-left font-normal">
              Time
            </th>
            <th class="px-3 py-2 text-right font-normal" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="lap in data.laps"
            :key="lap.id"
            class="bg-zinc-900/40 transition-colors"
            :class="selectedLapId === lap.id ? 'bg-green-500/10' : 'hover:bg-zinc-900/70'"
          >
            <td class="rounded-l-md px-3 py-2 text-zinc-200">
              {{ lap.lapNumber }}
              <span
                v-if="bestLapMs === lap.timeMs"
                class="ml-2 rounded-sm bg-green-500/20 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.2em] text-green-300"
              >
                best
              </span>
            </td>
            <td class="px-3 py-2 text-zinc-100 tabular-nums">
              {{ formatLap(lap.timeMs) }}
            </td>
            <td class="rounded-r-md px-3 py-2 text-right">
              <button
                type="button"
                class="rounded-sm border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-green-500/60 hover:text-green-300 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="loadingFrames"
                @click="selectLap(lap.id)"
              >
                {{ loadingFrames && selectedLapId === lap.id ? 'Loading…' : '▶ Replay' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <div
      v-else
      class="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center font-mono text-sm text-zinc-500"
    >
      No laps captured in this session.
    </div>

    <div
      v-if="framesError"
      class="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300"
    >
      {{ framesError }}
    </div>

    <section
      v-if="replayFrames && replayFrames.length > 0"
      class="mt-8"
    >
      <ReplayPlayer
        :key="selectedLapId ?? 0"
        :frames="replayFrames"
      />
    </section>

    <ConfirmModal
      v-model:open="deleteOpen"
      :title="`Delete session #${sessionId}?`"
      confirm-label="Delete session"
      :busy="deleting"
      @confirm="confirmDelete"
    >
      <p>
        Permanently remove this session.
        <span class="text-zinc-300">Cannot be undone.</span>
      </p>
      <ul class="mt-3 space-y-1 text-xs text-zinc-300">
        <li>· {{ cascadeLaps }} lap{{ cascadeLaps === 1 ? '' : 's' }} removed</li>
        <li v-if="data?.session.tuneLabel">
          · tune label: {{ data.session.tuneLabel }}
        </li>
      </ul>
    </ConfirmModal>
  </main>
</template>
