<script setup lang="ts">
import { navForGame } from '~/utils/nav'
import { formatLap, formatDelta } from '~/utils/format'

useHead({ title: 'Hotlap · co-driver' })

const { capabilities } = useGame()
const navItems = computed(() => navForGame(capabilities.value))

definePageMeta({
  // Phone-propped-next-to-TV use case, same as /live — drop the site
  // header on narrow viewports so the readouts get the full screen.
  hideHeaderOnMobile: true
})

const { telemetry, hasReceivedFrame, lastLiveCar } = useTelemetry()
const { recording } = useRecording()

// ----------------------------------------------------------------------------
// Live readouts straight from the telemetry frame.
// ----------------------------------------------------------------------------
const lapNumber = computed(() => telemetry.value?.lap.number ?? 0)
const racePosition = computed(() => telemetry.value?.lap.racePosition ?? 0)
const raceTimeS = computed(() => telemetry.value?.lap.raceTime ?? 0)
const currentLapMs = computed(() => (telemetry.value?.lap.current ?? 0) * 1000)
const lastLapMs = computed<number | null>(() => {
  const s = telemetry.value?.lap.last ?? 0
  return s > 0 ? s * 1000 : null
})
const bestLapMs = computed<number | null>(() => {
  const s = telemetry.value?.lap.best ?? 0
  return s > 0 ? s * 1000 : null
})
const speedKmh = computed(() => Math.round(telemetry.value?.speedKmh ?? 0))
const gear = computed(() => telemetry.value?.gear ?? 0)

// Car identity for the metadata strip. Prefer the recording state since it
// carries displayName + tune label; fall back to lastLiveCar, which survives
// the pause-zeros that telemetry.car shows during menus.
const car = computed(() => {
  const r = recording.value
  if (r.state === 'recording') {
    return {
      classLetter: classForDisplay(r.piAtStart, r.carClass),
      displayName: r.carDisplayName ?? `Car #${r.carOrdinal}`,
      pi: r.piAtStart,
      tuneLabel: r.tuneLabel ?? 'untuned'
    }
  }
  const live = lastLiveCar.value
  if (live) {
    return {
      classLetter: classForDisplay(live.pi, live.class),
      displayName: `Car #${live.ordinal}`,
      pi: live.pi,
      tuneLabel: 'not recording'
    }
  }
  return null
})

// ----------------------------------------------------------------------------
// Rolling delta, predicted lap, theoretical best, per-sector deltas — all
// derived from the session's best completed lap. Reference is built client-
// side from the in-progress lap's frames; first lap shows `—` everywhere
// until you cross the line, then the page comes alive. PB fallback (for an
// instant reference on session start) is a separate iteration.
// ----------------------------------------------------------------------------
const {
  rollingDeltaMs,
  predictedLapMs,
  theoreticalLapMs,
  sectorStates,
  referencePoints,
  currentPoint
} = useHotlapReference()

const deltaMs = rollingDeltaMs

const SECTOR_LABELS = ['S1', 'S2', 'S3']
type SectorKind = 'purple' | 'green' | 'yellow' | 'red' | 'pending'
const sectors = computed<Array<{ label: string, deltaMs: number | null, kind: SectorKind }>>(() =>
  sectorStates.value.map((state, i) => ({
    label: SECTOR_LABELS[i]!,
    deltaMs: state?.deltaMs ?? null,
    kind: state?.kind ?? 'pending'
  }))
)

// Zero-centred delta bar geometry. Clamped to ±DELTA_MAX_MS so a single bad
// lap doesn't peg the bar; numeric readout always shows the true value.
const DELTA_MAX_MS = 1000
const deltaPct = computed(() => {
  const d = deltaMs.value
  return d === null ? 0 : Math.min(1, Math.abs(d) / DELTA_MAX_MS)
})
const deltaAhead = computed(() => {
  const d = deltaMs.value
  return d !== null && d < 0
})

// Subtle peripheral-vision tint on the hero card — green when ahead, amber
// when behind. Mimics the AiM / MoTeC LED-bar convention. Empty when there's
// no reference lap to compare to.
const heroTintClass = computed(() => {
  if (deltaMs.value === null) return ''
  return deltaAhead.value ? 'bg-green-500/[0.04]' : 'bg-amber-500/[0.04]'
})

const SECTOR_CLASS_MAP: Record<SectorKind, string> = {
  purple: 'border-purple-500/40 bg-purple-500/10 text-purple-200',
  green: 'border-green-500/40 bg-green-500/10 text-green-200',
  yellow: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  red: 'border-red-500/40 bg-red-500/10 text-red-200',
  pending: 'border-zinc-800 bg-zinc-900/40 text-zinc-500'
}

function formatRaceTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}
</script>

<template>
  <div class="container mx-auto max-w-6xl">
    <!-- Floating hamburger — only nav chrome when the site header is hidden
         on phone-sized viewports. Mirrors the /live page. -->
    <UDropdownMenu
      :items="navItems"
      class="fixed top-1 left-1 z-40 hidden max-sm:block [@media(max-height:500px)]:block"
    >
      <UButton
        icon="i-lucide-menu"
        variant="ghost"
        color="neutral"
        size="sm"
        aria-label="Open menu"
        class="bg-zinc-950/70 text-zinc-300 backdrop-blur-sm hover:text-zinc-100"
      />
    </UDropdownMenu>

    <!-- Waiting state — never received a frame yet. -->
    <TelemetryWaiting
      v-if="!hasReceivedFrame"
      variant="full"
    />

    <div
      v-else
      class="space-y-3 px-4 py-3 sm:px-6 sm:py-6"
    >
      <!-- Eyebrow strip: lap number · race position · cumulative race time -->
      <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        <div class="flex items-center gap-3">
          <span>
            Lap <span class="tabular-nums text-zinc-300">{{ lapNumber }}</span>
          </span>
          <template v-if="racePosition > 0">
            <span class="text-zinc-700">·</span>
            <span>
              P <span class="tabular-nums text-zinc-300">{{ racePosition }}</span>
            </span>
          </template>
        </div>
        <span>
          race
          <span class="ml-1 tabular-nums normal-case tracking-normal text-zinc-300">{{ formatRaceTime(raceTimeS) }}</span>
        </span>
      </div>

      <!-- Hero: giant current lap time + zero-centred delta bar -->
      <section
        class="card relative overflow-hidden p-5 transition-colors sm:p-6"
        :class="heroTintClass"
      >
        <div class="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          Current lap
        </div>
        <div class="mt-1 font-mono text-6xl tabular-nums text-zinc-100 sm:text-7xl">
          {{ formatLap(currentLapMs) }}
        </div>

        <div class="mt-5">
          <!-- Bar: zero-centred, fills outward to indicate magnitude. -->
          <div class="relative h-2 overflow-hidden rounded-full bg-zinc-800">
            <div class="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-zinc-600" />
            <div
              v-if="deltaMs !== null && deltaAhead"
              class="absolute top-0 bottom-0 rounded-full bg-green-500/80"
              :style="{ right: '50%', width: `${(deltaPct * 50).toFixed(2)}%` }"
            />
            <div
              v-else-if="deltaMs !== null"
              class="absolute top-0 bottom-0 rounded-full bg-amber-500/80"
              :style="{ left: '50%', width: `${(deltaPct * 50).toFixed(2)}%` }"
            />
          </div>
          <div class="mt-2 flex items-baseline justify-between font-mono">
            <span class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              Delta to best
            </span>
            <span
              class="text-2xl tabular-nums sm:text-3xl"
              :class="deltaMs === null ? 'text-zinc-500' : (deltaAhead ? 'text-green-300' : 'text-amber-300')"
            >
              {{ formatDelta(deltaMs) }}<span v-if="deltaMs !== null"> s</span>
            </span>
          </div>
        </div>
      </section>

      <!-- Sector cells: each independently coloured by its own state. -->
      <section class="grid grid-cols-3 gap-2">
        <div
          v-for="s in sectors"
          :key="s.label"
          class="rounded-md border px-3 py-2 font-mono"
          :class="SECTOR_CLASS_MAP[s.kind]"
        >
          <div class="text-[10px] uppercase tracking-[0.3em] opacity-70">
            {{ s.label }}
          </div>
          <div class="mt-0.5 text-xl tabular-nums sm:text-2xl">
            {{ formatDelta(s.deltaMs) }}
          </div>
        </div>
      </section>

      <!-- Predicted / Last / Best, with theoretical-best footer -->
      <section class="card p-4 font-mono">
        <div class="grid grid-cols-3 gap-3">
          <div>
            <div class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              Predicted
            </div>
            <div class="mt-0.5 text-xl tabular-nums text-zinc-200">
              {{ formatLap(predictedLapMs) }}
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              Last
            </div>
            <div class="mt-0.5 text-xl tabular-nums text-zinc-300">
              {{ formatLap(lastLapMs) }}
            </div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              Best
            </div>
            <div class="mt-0.5 text-xl tabular-nums text-zinc-100">
              {{ formatLap(bestLapMs) }}
            </div>
          </div>
        </div>
        <div class="mt-3 flex items-baseline justify-between border-t border-zinc-800/80 pt-2">
          <span class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
            Theoretical
          </span>
          <span class="text-base tabular-nums text-zinc-300">
            {{ formatLap(theoreticalLapMs) }}
          </span>
        </div>
      </section>

      <!-- Speed + gear -->
      <section class="card flex items-center justify-around p-4">
        <div class="font-mono text-center">
          <div class="text-5xl tabular-nums text-zinc-100 sm:text-6xl">
            {{ speedKmh }}
          </div>
          <div class="mt-1 text-[10px] uppercase tracking-[0.3em] text-zinc-500">
            km/h
          </div>
        </div>
        <div class="flex h-20 w-20 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 font-mono text-5xl tabular-nums text-zinc-100 sm:h-24 sm:w-24 sm:text-6xl">
          {{ gear }}
        </div>
      </section>

      <!-- Track map — route is the session's reference lap (best so far),
           live cursor is the current position. Empty state until first lap
           completes, then route renders and the dot tracks live. -->
      <TrackMap
        :points="referencePoints"
        :current-point="currentPoint"
        title="track"
        :subtitle="referencePoints.length > 0 ? 'reference lap' : 'awaiting first lap'"
        compact
      />

      <!-- Bottom metadata strip — borrows the compare.vue dense-info row. -->
      <div class="-mx-4 flex items-center justify-between gap-3 border-y border-zinc-800/80 bg-zinc-950/40 px-4 py-2 font-mono text-xs text-zinc-300 sm:-mx-6 sm:px-6">
        <span>
          <template v-if="car">
            <span class="text-zinc-500">[{{ car.classLetter }}]</span>
            {{ car.displayName }}
            <span class="text-zinc-500">·</span>
            PI {{ car.pi }}
            <span class="text-zinc-500">·</span>
            {{ car.tuneLabel }}
          </template>
          <template v-else>
            <span class="text-zinc-500">no car identified</span>
          </template>
        </span>
        <NuxtLink
          to="/manual/hotlap"
          class="inline-flex items-center gap-1 text-zinc-500 hover:text-green-300"
          title="How to read the graphs on this page"
        >
          <UIcon
            name="i-lucide-book-open"
            class="h-3 w-3"
          />
          <span>manual</span>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
