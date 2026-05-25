<script setup lang="ts">
import { EVENT_TYPE_LABELS, isEventType, type EventType } from '~/utils/event-types'
import { formatLap, formatDelta } from '~/utils/format'
import { pointsFromFrames } from '~/utils/track-map'
import { computeSectorTimes, minSpeedPerSector } from '~/utils/sectors'
import { damperHistogramsForLap } from '~/utils/damper-velocity'
import { diffSetup, SOURCE_LABEL, type SetupDiffRow } from '~/utils/setup-diff'
import type { BuildSettings } from '~/utils/build-fields'
import type { TuneSettings } from '~/utils/tune-fields'
import type { Telemetry } from '../../../../../server/utils/decode'

const { format, unitLabel, prefs } = useUnits()

// Apex-speed delta uses the user's display unit so the numeric difference
// matches the side-by-side values. km/h → mph conversion is the only
// preference that affects this column.
const KMH_TO_MPH = 0.621371
function deltaSpeedDisplay(deltaKmh: number): string {
  const v = prefs.value.speed === 'mph' ? deltaKmh * KMH_TO_MPH : deltaKmh
  const sign = v > 0 ? '+' : ''
  return `${sign}${Math.round(v)} ${unitLabel.speed}`
}

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
  buildSnapshot: BuildSettings | null
  tuneSnapshot: TuneSettings | null
  buildName: string | null
  tuneName: string | null
  carOrdinal: number
  carClass: number
  carDisplayName: string | null
  frames: Telemetry[]
}

interface EventResponse {
  event: { id: number, name: string, type: EventType }
}

interface EventLap {
  lapId: number
  lapNumber: number
  timeMs: number
  sessionId: number
  tuneLabel: string | null
  piAtStart: number
  startedAt: string
  carOrdinal: number
  carClass: number
  carDisplayName: string | null
}

interface EventLapsResponse {
  eventId: number
  laps: EventLap[]
}

const [
  { data: eventData },
  { data: lapA, error: lapAError },
  { data: lapB, error: lapBError },
  { data: eventLapsData }
] = await Promise.all([
  useFetch<EventResponse>(`/api/events/${eventId}`),
  useFetch<LapResponse>(`/api/laps/${lapAId}/frames`),
  useFetch<LapResponse>(`/api/laps/${lapBId}/frames`),
  useFetch<EventLapsResponse>(`/api/events/${eventId}/laps`)
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

// --- Lap picker ----------------------------------------------------------
// Dropdowns let the player pivot without leaving the page. Selecting the
// same lap as the other side is disabled in the markup; the swap button
// flips A↔B in one click for the common "I picked them in the wrong
// order" case.

const eventLaps = computed<EventLap[]>(() => eventLapsData.value?.laps ?? [])

function dropdownLabel(l: EventLap): string {
  const car = l.carDisplayName ?? `#${l.carOrdinal}`
  const tune = l.tuneLabel ? ` · ${l.tuneLabel}` : ''
  return `Lap ${l.lapNumber} · ${formatLap(l.timeMs)} · ${car}${tune}`
}

async function selectLap(side: 'a' | 'b', e: Event): Promise<void> {
  const newId = Number((e.target as HTMLSelectElement).value)
  if (!Number.isInteger(newId) || newId <= 0) return
  if (side === 'a' && newId === lapBId) return
  if (side === 'b' && newId === lapAId) return
  await navigateTo({
    path: route.path,
    query: { ...route.query, [side]: newId }
  })
}

async function swapLaps(): Promise<void> {
  await navigateTo({
    path: route.path,
    query: { ...route.query, a: lapBId, b: lapAId }
  })
}

// --- TrackMap overlay ----------------------------------------------------
const COLOR_A = '#fafafa'
const COLOR_B = '#fbbf24'

const trackTraces = computed(() => {
  const a = lapA.value
  const b = lapB.value
  if (!a || !b) return []
  return [
    { points: pointsFromFrames(a.frames), label: 'A', stroke: COLOR_A, best: true },
    { points: pointsFromFrames(b.frames), label: 'B', stroke: COLOR_B }
  ]
})

// --- Damper velocity histograms ------------------------------------------
// Whole-lap aggregates per corner — A vs B side-by-side answers "what
// chassis behavior changed between these two tunes" at a glance.
const damperHistogramsA = computed(() =>
  lapA.value ? damperHistogramsForLap(lapA.value.frames) : null
)
const damperHistogramsB = computed(() =>
  lapB.value ? damperHistogramsForLap(lapB.value.frames) : null
)

// --- Sector + apex tables ------------------------------------------------
const SECTOR_LABELS = ['S1', 'S2', 'S3']

const sectorTimesA = computed(() => lapA.value ? computeSectorTimes(lapA.value.frames) : null)
const sectorTimesB = computed(() => lapB.value ? computeSectorTimes(lapB.value.frames) : null)
const apexA = computed(() => lapA.value ? minSpeedPerSector(lapA.value.frames) : null)
const apexB = computed(() => lapB.value ? minSpeedPerSector(lapB.value.frames) : null)

interface SectorRow {
  label: string
  aMs: number | null
  bMs: number | null
  deltaMs: number | null
}
const sectorRows = computed<SectorRow[]>(() => {
  const a = sectorTimesA.value
  const b = sectorTimesB.value
  return SECTOR_LABELS.map((label, i) => {
    const av = a?.[i] ?? null
    const bv = b?.[i] ?? null
    return {
      label,
      aMs: av,
      bMs: bv,
      deltaMs: (av !== null && bv !== null) ? bv - av : null
    }
  })
})

interface ApexRow {
  label: string
  aKmh: number | null
  bKmh: number | null
  deltaKmh: number | null
}
const apexRows = computed<ApexRow[]>(() => {
  const a = apexA.value
  const b = apexB.value
  return SECTOR_LABELS.map((label, i) => {
    const av = a?.[i] ?? null
    const bv = b?.[i] ?? null
    return {
      label,
      aKmh: av,
      bKmh: bv,
      // Apex speed: higher is better, so green when A carries more speed
      // (negative delta in B-A space). Mirrors the lap-time convention
      // where green = "A did better in this measurement."
      deltaKmh: (av !== null && bv !== null) ? bv - av : null
    }
  })
})

// Color rule shared by both tables: green when A did better (lower time,
// higher apex), amber when B did better, neutral otherwise.
function deltaToneClass(deltaIsAGood: number | null): string {
  if (deltaIsAGood === null || Math.abs(deltaIsAGood) < 0.5) return 'text-zinc-400'
  return deltaIsAGood > 0 ? 'text-green-300' : 'text-amber-300'
}

// --- Setup diff ----------------------------------------------------------
// `diffSetup(current, prior)` is generic over two snapshots; we map A→current,
// B→prior so the row's currentValue/priorValue end up as A/B in the UI.
const diffRows = computed<SetupDiffRow[]>(() => {
  const a = lapA.value
  const b = lapB.value
  if (!a || !b) return []
  return diffSetup(
    { build: a.buildSnapshot, tune: a.tuneSnapshot },
    { build: b.buildSnapshot, tune: b.tuneSnapshot }
  )
})
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader title="Compare">
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
        <NuxtLink
          :to="`/events/${eventTypeKey}/${eventId}`"
          class="hover:text-zinc-300"
        >
          {{ eventData?.event.name }}
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <span class="text-zinc-300">Compare</span>
      </template>
      <template #actions>
        <div
          class="rounded-md border px-4 py-3 font-mono text-sm tabular-nums"
          :class="aAhead ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'"
        >
          <div class="text-[10px] uppercase tracking-[0.2em] opacity-70">
            {{ aAhead ? 'A faster by' : 'B faster by' }}
          </div>
          <div class="mt-0.5 text-xl">
            {{ formatDelta(netDelta) }} s
          </div>
        </div>
      </template>
    </PageHeader>

    <!-- Lap-picker row: two cards with per-side dropdowns + a swap button. -->
    <section class="mb-6 grid grid-cols-1 items-stretch gap-3 font-mono text-sm sm:grid-cols-[1fr_auto_1fr]">
      <NuxtLink
        :to="`/events/${eventTypeKey}/${eventId}/${lapA?.sessionId}`"
        class="block card p-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900/70"
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

      <div class="flex items-center justify-center sm:px-1">
        <button
          type="button"
          class="rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2 font-mono text-xs uppercase tracking-[0.2em] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          title="Swap A and B"
          @click="swapLaps"
        >
          <span class="sm:hidden">Swap A ↑↓ B</span>
          <span class="hidden sm:inline">⇄</span>
        </button>
      </div>

      <NuxtLink
        :to="`/events/${eventTypeKey}/${eventId}/${lapB?.sessionId}`"
        class="block card p-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900/70"
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

    <!-- Pick a different lap for either side. Native select for portability —
         the list can be long but native UI handles that well on mobile. -->
    <section
      v-if="eventLaps.length > 1"
      class="mb-6 grid grid-cols-1 gap-3 font-mono text-xs sm:grid-cols-[1fr_auto_1fr]"
    >
      <label class="flex items-center gap-2 text-zinc-500">
        <span class="text-[10px] uppercase tracking-[0.2em]">Pick A</span>
        <select
          class="flex-1 rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1.5 text-zinc-200 focus:border-zinc-500 focus:outline-none"
          :value="lapAId"
          @change="selectLap('a', $event)"
        >
          <option
            v-for="l in eventLaps"
            :key="l.lapId"
            :value="l.lapId"
            :disabled="l.lapId === lapBId"
          >
            {{ dropdownLabel(l) }}
          </option>
        </select>
      </label>
      <span aria-hidden="true" />
      <label class="flex items-center gap-2 text-zinc-500">
        <span class="text-[10px] uppercase tracking-[0.2em]">Pick B</span>
        <select
          class="flex-1 rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1.5 text-zinc-200 focus:border-zinc-500 focus:outline-none"
          :value="lapBId"
          @change="selectLap('b', $event)"
        >
          <option
            v-for="l in eventLaps"
            :key="l.lapId"
            :value="l.lapId"
            :disabled="l.lapId === lapAId"
          >
            {{ dropdownLabel(l) }}
          </option>
        </select>
      </label>
    </section>

    <OverlayTraces
      v-if="lapA && lapB"
      :frames-a="lapA.frames"
      :frames-b="lapB.frames"
      :label-a="labelFor(lapA)"
      :label-b="labelFor(lapB)"
    />

    <!-- Track-map overlay: both routes in their legend colors. The TrackMap
         component hides its colour-mode chips because every trace here has
         an explicit stroke override. -->
    <div class="mt-6">
      <TrackMap
        :traces="trackTraces"
        title="track"
        subtitle="A · B"
      />
    </div>

    <!-- Damper velocity histograms — A vs B per-corner envelopes. Direct
         chassis-behavior diff between the two tunes; the histogram shape
         is the measurement. -->
    <section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <SuspensionHistogram
        :histograms="damperHistogramsA"
        title="A · damper velocity"
        subtitle="whole lap"
      />
      <SuspensionHistogram
        :histograms="damperHistogramsB"
        title="B · damper velocity"
        subtitle="whole lap"
      />
    </section>

    <!-- Sector deltas + per-sector min speed (apex proxy). -->
    <section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="card p-4 font-mono text-sm">
        <header class="mb-3 flex items-baseline justify-between text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          <span>Sector times</span>
          <span class="normal-case tracking-normal text-zinc-600">equal-distance splits</span>
        </header>
        <table class="w-full tabular-nums">
          <thead class="text-left text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <tr>
              <th class="py-1 font-normal">
                Sector
              </th>
              <th class="py-1 font-normal text-right">
                A
              </th>
              <th class="py-1 font-normal text-right">
                B
              </th>
              <th class="py-1 font-normal text-right">
                Δ
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800/60">
            <tr
              v-for="row in sectorRows"
              :key="row.label"
            >
              <td class="py-1.5 text-zinc-400">
                {{ row.label }}
              </td>
              <td class="py-1.5 text-right text-zinc-100">
                {{ row.aMs !== null ? formatLap(row.aMs) : '—' }}
              </td>
              <td class="py-1.5 text-right text-zinc-300">
                {{ row.bMs !== null ? formatLap(row.bMs) : '—' }}
              </td>
              <td
                class="py-1.5 text-right"
                :class="deltaToneClass(row.deltaMs)"
              >
                {{ row.deltaMs !== null ? formatDelta(row.deltaMs) + ' s' : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card p-4 font-mono text-sm">
        <header class="mb-3 flex items-baseline justify-between text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          <span>Min speed per sector</span>
          <span class="normal-case tracking-normal text-zinc-600">apex proxy</span>
        </header>
        <table class="w-full tabular-nums">
          <thead class="text-left text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <tr>
              <th class="py-1 font-normal">
                Sector
              </th>
              <th class="py-1 font-normal text-right">
                A
              </th>
              <th class="py-1 font-normal text-right">
                B
              </th>
              <th class="py-1 font-normal text-right">
                Δ
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800/60">
            <tr
              v-for="row in apexRows"
              :key="row.label"
            >
              <td class="py-1.5 text-zinc-400">
                {{ row.label }}
              </td>
              <td class="py-1.5 text-right text-zinc-100">
                {{ row.aKmh !== null ? format.speed(row.aKmh) : '—' }}
              </td>
              <td class="py-1.5 text-right text-zinc-300">
                {{ row.bKmh !== null ? format.speed(row.bKmh) : '—' }}
              </td>
              <td
                class="py-1.5 text-right"
                :class="deltaToneClass(row.deltaKmh !== null ? -row.deltaKmh : null)"
              >
                {{ row.deltaKmh !== null ? deltaSpeedDisplay(row.deltaKmh) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Setup diff — fields where Lap A's session differs from Lap B's. -->
    <section
      v-if="diffRows.length"
      class="mt-6 card p-4 font-mono text-sm"
    >
      <header class="mb-3 flex items-baseline justify-between text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        <span>Setup diff</span>
        <span class="normal-case tracking-normal text-zinc-600">{{ diffRows.length }} change{{ diffRows.length === 1 ? '' : 's' }}</span>
      </header>
      <ul class="space-y-1">
        <li
          v-for="row in diffRows"
          :key="`${row.source}:${row.fieldId}`"
          class="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 tabular-nums"
        >
          <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            {{ SOURCE_LABEL[row.source] }} · {{ row.section }}
          </span>
          <span class="text-zinc-200">
            {{ row.fieldLabel }}
          </span>
          <span class="text-right text-zinc-300">
            <span class="text-zinc-500">A:</span> {{ row.currentValue }}
            <span class="ml-2 text-zinc-500">B:</span> {{ row.priorValue }}
          </span>
        </li>
      </ul>
    </section>
  </main>
</template>
