<script setup lang="ts">
import type { EventType } from '~/utils/event-types'
import { formatLap, formatDelta } from '~/utils/format'
import { pointsFromFrames } from '~/utils/track-map'
import { computeSectorTimes, minSpeedPerSector } from '~/utils/sectors'
import { damperHistogramsForLap, damperScatterForLap } from '~/utils/damper-velocity'
import { rideHeightHistogramsForLap } from '~/utils/ride-height'
import { slipAngleBalanceDistribution, tireTempDistributions } from '~/utils/channel-distributions'
import { binFrames } from '~/utils/dyno'
import { diffSetup, SOURCE_LABEL, type SetupDiffRow } from '~/utils/setup-diff'
import type { BuildSettings } from '~/utils/build-fields'
import type { TuneSettings } from '~/utils/tune-fields'
import type { Telemetry } from '../../../../server/utils/decode'

// Selection lives entirely in the query string, so any change re-runs setup
// with a fresh fetch. Capturing query into plain consts (rather than reactive
// computeds) is only safe because of this remount-on-fullPath key.
definePageMeta({ key: route => route.fullPath })

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
const eventIdParam = Number(route.params.id)

if (!Number.isInteger(eventIdParam) || eventIdParam <= 0) {
  throw createError({ statusCode: 404, statusMessage: 'invalid compare params' })
}
const eventId = eventIdParam

// --- Selection from query ------------------------------------------------
// `laps` is the canonical ordered, comma-separated lap-id list. `a`/`b` are a
// two-lap fallback so old compare links keep working. `ref` is the time
// baseline + left side of every pairwise panel; `focus` is the right side.
function parseIds(raw: unknown): number[] {
  return String(raw ?? '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n > 0)
}

const lapIds: number[] = (() => {
  const fromLaps = parseIds(route.query.laps)
  if (fromLaps.length) return [...new Set(fromLaps)]
  const pair = [Number(route.query.a), Number(route.query.b)]
    .filter(n => Number.isInteger(n) && n > 0)
  return [...new Set(pair)]
})()

if (lapIds.length < 2) {
  throw createError({ statusCode: 404, statusMessage: 'compare needs at least two laps' })
}

const refId: number = (() => {
  const q = Number(route.query.ref)
  return Number.isInteger(q) && lapIds.includes(q) ? q : lapIds[0]!
})()
const focusId: number = (() => {
  const q = Number(route.query.focus)
  if (Number.isInteger(q) && q !== refId && lapIds.includes(q)) return q
  return lapIds.find(id => id !== refId)!
})()

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
  event: { id: number, name: string, type: EventType | null }
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

// Fetch every selected lap's frames in parallel; the key includes the id list
// so navigating to a different set refetches.
const { data: lapsFramesData, error: lapsError } = await useAsyncData(
  `compare-frames-${lapIds.join('-')}`,
  () => Promise.all(lapIds.map(id => $fetch<LapResponse>(`/api/laps/${id}/frames`)))
)

const [{ data: eventData }, { data: eventLapsData }] = await Promise.all([
  useFetch<EventResponse>(`/api/events/${eventId}`),
  useFetch<EventLapsResponse>(`/api/events/${eventId}/laps`)
])

if (lapsError.value || !lapsFramesData.value) {
  throw createError({ statusCode: 404, statusMessage: 'lap not found' })
}
const lapResponses = lapsFramesData.value
for (const l of lapResponses) {
  if (l.eventId !== eventId) {
    throw createError({ statusCode: 400, statusMessage: 'lap does not belong to this event' })
  }
}

function lapById(id: number): LapResponse | undefined {
  return lapResponses.find(l => l.lapId === id)
}

// Internally the whole pairwise section reads `lapA` (reference) and `lapB`
// (focus); keeping those names means none of the per-corner panels below had
// to change when the page went multi-lap.
const lapA = computed<LapResponse | undefined>(() => lapById(refId))
const lapB = computed<LapResponse | undefined>(() => lapById(focusId))

function labelFor(l: LapResponse): string {
  return `${formatLap(l.timeMs)} · ${l.tuneLabel ?? 'untuned'}`
}

const netDelta = computed(() => (lapB.value?.timeMs ?? 0) - (lapA.value?.timeMs ?? 0))
const refAhead = computed(() => netDelta.value > 0)

// --- Palette + overlay laps ----------------------------------------------
// Color is assigned by position in the selected list so it's stable as the
// reference/focus move around. Reference = white, then a distinguishable ramp.
const COMPARE_PALETTE = ['#fafafa', '#fbbf24', '#22d3ee', '#a78bfa', '#34d399', '#f472b6']

interface CompareLap {
  id: number
  resp: LapResponse
  color: string
  isRef: boolean
  isFocus: boolean
}
const compareLaps = computed<CompareLap[]>(() => {
  const out: CompareLap[] = []
  lapIds.forEach((id, i) => {
    const resp = lapById(id)
    if (!resp) return
    out.push({
      id,
      resp,
      color: COMPARE_PALETTE[i % COMPARE_PALETTE.length]!,
      isRef: id === refId,
      isFocus: id === focusId
    })
  })
  return out
})

const refColor = computed(() => compareLaps.value.find(l => l.isRef)?.color ?? COMPARE_PALETTE[0]!)
const focusColor = computed(() => compareLaps.value.find(l => l.isFocus)?.color ?? COMPARE_PALETTE[1]!)

// Every selected lap overlays on the traces; the reference is the Δ baseline.
const overlayLaps = computed(() =>
  compareLaps.value.map(l => ({
    frames: l.resp.frames,
    label: labelFor(l.resp),
    color: l.color
  }))
)
const referenceIndex = computed(() => compareLaps.value.findIndex(l => l.isRef))

// --- TrackMap overlay ----------------------------------------------------
const trackTraces = computed(() =>
  compareLaps.value.map(l => ({
    points: pointsFromFrames(l.resp.frames),
    label: l.isRef ? 'ref' : l.isFocus ? 'focus' : undefined,
    stroke: l.color,
    best: l.isRef
  }))
)

// --- Lap-set navigation --------------------------------------------------
// Every mutation routes through the query so the page remounts and refetches.
function buildQuery(next: { laps?: number[], ref?: number, focus?: number }): Record<string, string> {
  return {
    laps: (next.laps ?? lapIds).join(','),
    ref: String(next.ref ?? refId),
    focus: String(next.focus ?? focusId)
  }
}

const eventLaps = computed<EventLap[]>(() => eventLapsData.value?.laps ?? [])
const availableToAdd = computed<EventLap[]>(() =>
  eventLaps.value.filter(l => !lapIds.includes(l.lapId))
)

function dropdownLabel(l: EventLap): string {
  const car = l.carDisplayName ?? `#${l.carOrdinal}`
  const tune = l.tuneLabel ? ` · ${l.tuneLabel}` : ''
  return `Lap ${l.lapNumber} · ${formatLap(l.timeMs)} · ${car}${tune}`
}

async function addLap(e: Event): Promise<void> {
  const id = Number((e.target as HTMLSelectElement).value)
  if (!Number.isInteger(id) || id <= 0 || lapIds.includes(id)) return
  await navigateTo({ path: route.path, query: buildQuery({ laps: [...lapIds, id] }) })
}

async function removeLap(id: number): Promise<void> {
  if (lapIds.length <= 2) return
  const laps = lapIds.filter(x => x !== id)
  let ref = refId
  let focus = focusId
  if (ref === id) ref = laps[0]!
  if (focus === id || focus === ref) focus = laps.find(x => x !== ref)!
  await navigateTo({ path: route.path, query: buildQuery({ laps, ref, focus }) })
}

async function setReference(id: number): Promise<void> {
  if (id === refId) return
  // Reference can't also be focus — bump focus to another lap if it collides.
  const focus = focusId === id ? lapIds.find(x => x !== id)! : focusId
  await navigateTo({ path: route.path, query: buildQuery({ ref: id, focus }) })
}

async function setFocus(id: number): Promise<void> {
  if (id === refId || id === focusId) return
  await navigateTo({ path: route.path, query: buildQuery({ focus: id }) })
}

async function swapRefFocus(): Promise<void> {
  await navigateTo({ path: route.path, query: buildQuery({ ref: focusId, focus: refId }) })
}

// --- Damper velocity histograms (reference vs focus) ---------------------
const damperHistogramsA = computed(() =>
  lapA.value ? damperHistogramsForLap(lapA.value.frames) : null
)
const damperHistogramsB = computed(() =>
  lapB.value ? damperHistogramsForLap(lapB.value.frames) : null
)

const rideHeightHistogramsA = computed(() =>
  lapA.value ? rideHeightHistogramsForLap(lapA.value.frames) : null
)
const rideHeightHistogramsB = computed(() =>
  lapB.value ? rideHeightHistogramsForLap(lapB.value.frames) : null
)
const damperScatterA = computed(() =>
  lapA.value ? damperScatterForLap(lapA.value.frames) : null
)
const damperScatterB = computed(() =>
  lapB.value ? damperScatterForLap(lapB.value.frames) : null
)

const dynoCurveA = computed(() => lapA.value ? binFrames(lapA.value.frames) : null)
const dynoCurveB = computed(() => lapB.value ? binFrames(lapB.value.frames) : null)
const slipAngleBalanceA = computed(() =>
  lapA.value ? slipAngleBalanceDistribution(lapA.value.frames) : null
)
const slipAngleBalanceB = computed(() =>
  lapB.value ? slipAngleBalanceDistribution(lapB.value.frames) : null
)
const tireTempA = computed(() =>
  lapA.value ? tireTempDistributions(lapA.value.frames) : null
)
const tireTempB = computed(() =>
  lapB.value ? tireTempDistributions(lapB.value.frames) : null
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
      // Apex speed: higher is better, so green when the reference carries more
      // speed (negative delta in focus-ref space). Mirrors the lap-time
      // convention where green = "reference did better in this measurement."
      deltaKmh: (av !== null && bv !== null) ? bv - av : null
    }
  })
})

// Color rule shared by both tables: green when the reference did better (lower
// time, higher apex), amber when focus did better, neutral otherwise.
function deltaToneClass(deltaIsRefGood: number | null): string {
  if (deltaIsRefGood === null || Math.abs(deltaIsRefGood) < 0.5) return 'text-zinc-400'
  return deltaIsRefGood > 0 ? 'text-green-300' : 'text-amber-300'
}

// --- Setup diff (reference vs focus) -------------------------------------
// `diffSetup(current, prior)` is generic over two snapshots; we map ref→current,
// focus→prior so the row's currentValue/priorValue end up as ref/focus in the UI.
const diffRows = computed<SetupDiffRow[]>(() => {
  const a = lapA.value
  const b = lapB.value
  if (!a || !b) return []
  return diffSetup(
    { build: a.buildSnapshot, tune: a.tuneSnapshot },
    { build: b.buildSnapshot, tune: b.tuneSnapshot }
  )
})

// Signed numeric change expressed as focus relative to ref (currentNum=ref,
// priorNum=focus): ref 10 → focus 13 reads "+3". Null for enum/text rows.
function diffDelta(row: SetupDiffRow): string | null {
  if (row.currentNum === null || row.priorNum === null) return null
  const d = row.priorNum - row.currentNum
  if (d === 0) return null
  const sign = d > 0 ? '+' : '−'
  const mag = Math.abs(d)
  const num = Number.isInteger(mag) ? String(mag) : Number(mag.toFixed(2)).toString()
  return `${sign}${num}`
}
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
          :to="`/events/${eventId}`"
          class="hover:text-zinc-300"
        >
          {{ eventData?.event.name }}
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <span class="text-zinc-300">Compare</span>
        <span class="text-zinc-700">·</span>
        <NuxtLink
          to="/manual/compare"
          class="inline-flex items-center gap-1 text-zinc-500 hover:text-green-300"
          title="How to read the graphs on this page"
        >
          <UIcon
            name="i-lucide-book-open"
            class="h-3.5 w-3.5"
          />
          <span>manual</span>
        </NuxtLink>
      </template>
      <template #actions>
        <div
          class="rounded-md border px-4 py-3 font-mono text-sm tabular-nums"
          :class="refAhead ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'"
        >
          <div class="text-[10px] uppercase tracking-[0.2em] opacity-70">
            {{ refAhead ? 'ref faster by' : 'focus faster by' }}
          </div>
          <div class="mt-0.5 text-xl">
            {{ formatDelta(netDelta) }} s
          </div>
        </div>
      </template>
    </PageHeader>

    <!-- Lap set: a chip per selected lap with its overlay color. The reference
         (Δ baseline + left of every pairwise panel) and focus (right of every
         pairwise panel) are tagged; the rest are overlay-only on the traces and
         track map. Add more laps from the dropdown to see small vs big changes. -->
    <section class="mb-6 space-y-3">
      <div class="flex flex-wrap items-stretch gap-2 font-mono text-xs">
        <div
          v-for="l in compareLaps"
          :key="l.id"
          class="flex items-center gap-2 rounded-md border px-3 py-2"
          :class="l.isRef
            ? 'border-zinc-400/70 bg-zinc-800/60'
            : l.isFocus
              ? 'border-amber-500/40 bg-amber-500/5'
              : 'border-zinc-800 bg-zinc-900/40'"
        >
          <span
            class="inline-block h-2 w-3 shrink-0"
            :style="{ background: l.color }"
          />
          <NuxtLink
            :to="`/events/${eventId}/${l.resp.sessionId}`"
            class="text-zinc-200 hover:text-green-300"
            :title="`Session #${l.resp.sessionId}`"
          >
            <span class="text-zinc-100">Lap {{ l.resp.lapNumber }}</span>
            <span class="text-zinc-500"> · </span>
            <span class="tabular-nums">{{ formatLap(l.resp.timeMs) }}</span>
            <span class="text-zinc-500"> · </span>
            <span class="text-zinc-400">{{ l.resp.carDisplayName ?? `#${l.resp.carOrdinal}` }}</span>
            <template v-if="l.resp.tuneLabel">
              <span class="text-zinc-500"> · </span>
              <span class="text-zinc-400">{{ l.resp.tuneLabel }}</span>
            </template>
          </NuxtLink>

          <span class="ml-1 flex items-center gap-1">
            <button
              type="button"
              class="rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.15em] transition-colors disabled:cursor-default"
              :class="l.isRef
                ? 'border-zinc-400/70 bg-zinc-700/50 text-zinc-100'
                : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-200'"
              :disabled="l.isRef"
              title="Use as reference (Δ baseline + left of pairwise panels)"
              @click="setReference(l.id)"
            >
              ref
            </button>
            <button
              type="button"
              class="rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.15em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              :class="l.isFocus
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-200'"
              :disabled="l.isRef || l.isFocus"
              title="Use as focus (right of pairwise panels)"
              @click="setFocus(l.id)"
            >
              focus
            </button>
            <button
              type="button"
              class="rounded border border-zinc-800 px-1.5 py-0.5 text-zinc-600 transition-colors hover:border-red-500/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="compareLaps.length <= 2"
              title="Remove from comparison"
              @click="removeLap(l.id)"
            >
              ✕
            </button>
          </span>
        </div>

        <button
          type="button"
          class="rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          title="Swap reference and focus"
          @click="swapRefFocus"
        >
          ⇄ swap ref/focus
        </button>
      </div>

      <label
        v-if="availableToAdd.length > 0"
        class="flex items-center gap-2 font-mono text-xs text-zinc-500"
      >
        <span class="text-[10px] uppercase tracking-[0.2em]">Add lap</span>
        <select
          class="flex-1 rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1.5 text-zinc-200 focus:border-zinc-500 focus:outline-none sm:max-w-md"
          :value="''"
          @change="addLap($event)"
        >
          <option
            value=""
            disabled
          >
            Pick a lap to overlay…
          </option>
          <option
            v-for="l in availableToAdd"
            :key="l.lapId"
            :value="l.lapId"
          >
            {{ dropdownLabel(l) }}
          </option>
        </select>
      </label>
    </section>

    <OverlayTraces
      v-if="overlayLaps.length"
      :laps="overlayLaps"
      :reference-index="referenceIndex"
    />

    <!-- Track-map overlay: every selected route in its legend color, reference
         on top. The TrackMap component hides its colour-mode chips because every
         trace here has an explicit stroke override. -->
    <div class="mt-6">
      <TrackMap
        :traces="trackTraces"
        title="track"
        :subtitle="`${compareLaps.length} laps`"
      />
    </div>

    <!-- Everything below is a pairwise reference-vs-focus comparison — the
         distribution panels stay legible at two laps where stacking N would
         turn to mud. Change the focus chip above to re-aim them. -->
    <div class="mt-8 mb-2 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <span>Pairwise</span>
      <span class="flex items-center gap-1.5 normal-case tracking-normal text-zinc-300">
        <span
          class="inline-block h-1.5 w-3"
          :style="{ background: refColor }"
        />ref
        <span class="text-zinc-600">vs</span>
        <span
          class="inline-block h-1.5 w-3"
          :style="{ background: focusColor }"
        />focus
      </span>
    </div>

    <!-- Damper velocity histograms — reference vs focus per-corner envelopes.
         Direct chassis-behavior diff between the two tunes; the histogram shape
         is the measurement. -->
    <section class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <SuspensionHistogram
        :histograms="damperHistogramsA"
        title="ref · damper velocity"
        subtitle="whole lap"
      />
      <SuspensionHistogram
        :histograms="damperHistogramsB"
        title="focus · damper velocity"
        subtitle="whole lap"
      />
    </section>

    <!-- Damper position × velocity — ref vs focus. The "C" shape exposes bump/
         rebound coupling the histogram can't. -->
    <section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <DamperScatter
        :scatter="damperScatterA"
        title="ref · damper position × velocity"
        subtitle="whole lap"
      />
      <DamperScatter
        :scatter="damperScatterB"
        title="focus · damper position × velocity"
        subtitle="whole lap"
      />
    </section>

    <!-- Ride-height distribution — ref vs focus. Where the platform sits over
         the lap; watch the bottoming band and front/rear asymmetry. -->
    <section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <RideHeightHistogram
        :histograms="rideHeightHistogramsA"
        title="ref · ride height"
        subtitle="whole lap"
      />
      <RideHeightHistogram
        :histograms="rideHeightHistogramsB"
        title="focus · ride height"
        subtitle="whole lap"
      />
    </section>

    <!-- Engine output — ref vs focus. Build-side changes (engine swap, aspiration,
         displacement) show here; tune-side changes leave both curves the same. -->
    <section
      v-if="(dynoCurveA && dynoCurveA.buckets.length) || (dynoCurveB && dynoCurveB.buckets.length)"
      class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <DynoCurve
        v-if="dynoCurveA"
        :curve="dynoCurveA"
        title="ref · dyno"
        subtitle="whole lap"
      />
      <DynoCurve
        v-if="dynoCurveB"
        :curve="dynoCurveB"
        title="focus · dyno"
        subtitle="whole lap"
      />
    </section>

    <!-- Chassis balance distribution — ref vs focus. Did the chassis lean more
         understeery / oversteery overall between these two tunes? -->
    <section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <ChannelHistogram
        :histogram="slipAngleBalanceA"
        title="ref · balance · front − rear slip angle"
        subtitle="cornering only"
        unit="°"
        :signed="true"
        left-label="oversteer"
        right-label="understeer"
      />
      <ChannelHistogram
        :histogram="slipAngleBalanceB"
        title="focus · balance · front − rear slip angle"
        subtitle="cornering only"
        unit="°"
        :signed="true"
        left-label="oversteer"
        right-label="understeer"
      />
    </section>

    <!-- Tire temperature distribution — ref vs focus per corner. Alignment and
         tire-pressure changes show here as heat-pattern shifts. -->
    <section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <QuadHistogram
        :histograms="tireTempA"
        title="ref · tire temperature"
        subtitle="whole lap"
        unit="°C"
      />
      <QuadHistogram
        :histograms="tireTempB"
        title="focus · tire temperature"
        subtitle="whole lap"
        unit="°C"
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
                ref
              </th>
              <th class="py-1 font-normal text-right">
                focus
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
                ref
              </th>
              <th class="py-1 font-normal text-right">
                focus
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

    <!-- Setup diff — fields where the reference lap's session differs from the
         focus lap's. -->
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
          class="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-x-3 tabular-nums"
        >
          <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            {{ SOURCE_LABEL[row.source] }} · {{ row.section }}
          </span>
          <span class="text-zinc-200">
            {{ row.fieldLabel }}
          </span>
          <span class="text-right text-zinc-300">
            <span class="text-zinc-500">ref:</span> {{ row.currentValue }}
            <span class="ml-2 text-zinc-500">focus:</span> {{ row.priorValue }}
          </span>
          <span
            class="w-14 text-right"
            :class="diffDelta(row) ? 'text-green-300' : 'text-zinc-700'"
            title="focus − ref"
          >{{ diffDelta(row) ?? '—' }}</span>
        </li>
      </ul>
    </section>
  </main>
</template>
