<script setup lang="ts">
import { INPUT_TRACE_LINES } from '~/utils/trace-lines'
import { TRACE_BUFFER_SIZE } from '~/utils/trace'

const { capabilities } = useGame()
const navItems = computed(() => navForGame(capabilities.value))

definePageMeta({
  // Drop the site header on narrow viewports so a phone propped next to the
  // TV gets the full screen for telemetry. Recording banner still shows.
  hideHeaderOnMobile: true
})

const {
  hasReceivedFrame,
  history,
  displayFrame,
  scrubIndex,
  paused,
  pauseSource,
  pauseManual,
  resume,
  setScrub,
  measurements
} = useTelemetry()

// Right-edge of the trace strip in game-clock ms. Tracks the latest sample
// in `history` (same source uPlot reads dataMax from), so the measurement
// strip below freezes alongside the trace strip on pause / scrub.
const tracesRightEdgeT = computed<number>(() => {
  const h = history.value
  return h.length > 0 ? (h[h.length - 1]?.t ?? 0) : 0
})

const TRACE_WINDOW_MS = (TRACE_BUFFER_SIZE / 60) * 1000

function fmtPct(v: number): string {
  return Math.round(v * 100) + '%'
}

// Keep the screen awake while telemetry is flowing — phone-as-sidecar use
// case. Silent if unsupported (iOS Safari < 16.4). Gated on hasReceivedFrame
// so an idle "WAITING" page doesn't hold the screen on indefinitely.
const wakeLock = useWakeLock()
watch(hasReceivedFrame, (rf) => {
  if (rf && wakeLock.isSupported.value && !wakeLock.isActive.value) {
    wakeLock.request('screen').catch(() => { /* user denied or tab inactive */ })
  }
}, { immediate: true })
onBeforeUnmount(() => {
  if (wakeLock.isActive.value) wakeLock.release()
})

// Trace strip is collapsed by default on phone-sized viewports — both
// portrait (narrow width) and landscape (short height). Initial value is
// read once at setup; subsequent viewport changes don't override an
// explicit toggle.
const isCompact = useMediaQuery('(max-width: 639px), (max-height: 500px)')
const traceExpanded = ref(!isCompact.value)
function toggleTrace() {
  traceExpanded.value = !traceExpanded.value
}

function onTogglePause() {
  if (paused.value) resume()
  else pauseManual()
}

// How far back from "now" the current scrub target is, in seconds.
const dvrSeconds = computed<number | null>(() => {
  const idx = scrubIndex.value
  if (idx === null) return null
  const h = history.value
  if (h.length === 0) return null
  const last = h[h.length - 1]
  const at = h[idx]
  if (!last || !at) return null
  return Math.max(0, (last.t - at.t) / 1000)
})
</script>

<template>
  <div class="container mx-auto max-w-6xl">
    <!-- Floating hamburger — the only nav chrome on phone-sized viewports,
         since the site header is hidden via `hideHeaderOnMobile`. Same
         items as the layout's mobile dropdown so the menu shape stays
         consistent across pages. Visibility class mirrors the header-hide
         media query exactly. -->
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

    <!-- Floating manual link — context-aware deep link to /manual/live.
         Sits in the top-right so it doesn't compete with the hamburger
         and is out of the way of the telemetry stack on landscape phones. -->
    <NuxtLink
      to="/manual/live"
      class="fixed top-1 right-1 z-40 inline-flex items-center gap-1 rounded-md bg-zinc-950/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400 backdrop-blur-sm transition-colors hover:text-green-300"
      title="How to read the graphs on this page"
    >
      <UIcon
        name="i-lucide-book-open"
        class="h-3 w-3"
      />
      <span class="hidden sm:inline">manual</span>
    </NuxtLink>

    <!-- Waiting state — never received a frame yet -->
    <TelemetryWaiting
      v-if="!hasReceivedFrame"
      variant="full"
    />

    <CornerView
      v-else
      :frame="displayFrame"
      :paused="paused && scrubIndex === null"
    />

    <section
      v-if="hasReceivedFrame"
      class="space-y-3 px-6 pb-6"
    >
      <!-- On mobile the trace strip starts collapsed to a slim toggle bar so
           the CornerView gets the full viewport. The canvas is unmounted
           while collapsed to keep ResizeObservers quiet. -->
      <button
        v-if="!traceExpanded"
        type="button"
        class="flex w-full items-center justify-between border-y border-zinc-800 bg-zinc-950/40 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-400 transition-colors hover:bg-zinc-900/60 hover:text-zinc-200"
        @click="toggleTrace"
      >
        <span>traces · last 30 s</span>
        <UIcon
          name="i-lucide-chevron-up"
          class="h-3.5 w-3.5"
        />
      </button>
      <div
        v-else
        class="relative"
      >
        <TraceStrip
          :history="history"
          :lines="INPUT_TRACE_LINES"
          label="traces · last 30 s"
          :paused="paused"
          :scrubbable="true"
          :scrub-index="scrubIndex"
          :buffer-length="history.length"
          @toggle-pause="onTogglePause"
          @scrub="setScrub"
        />
        <MeasurementStrip
          :series="[{ samples: measurements.tbRolling, bands: measurements.tbBands, color: '#a78bfa', pillLabel: 'TB%', fmt: fmtPct }]"
          :window-ms="TRACE_WINDOW_MS"
          label="TB% · 30 s"
          :latest-t="tracesRightEdgeT"
        />
        <MeasurementStrip
          :series="[{ samples: measurements.timeCoast, color: '#a1a1aa', pillLabel: 'CST', fmt: fmtPct }]"
          :window-ms="TRACE_WINDOW_MS"
          label="coast · 30 s"
          :latest-t="tracesRightEdgeT"
        />
        <MeasurementStrip
          :series="[{ samples: measurements.pedalOverlap, color: '#fb923c', pillLabel: 'OVL', fmt: fmtPct }]"
          :window-ms="TRACE_WINDOW_MS"
          label="pedal overlap · 30 s"
          :latest-t="tracesRightEdgeT"
        />
        <button
          v-if="isCompact"
          type="button"
          aria-label="Collapse trace strip"
          class="absolute top-1.5 right-1.5 z-10 rounded-sm border border-zinc-700/60 bg-zinc-950/70 p-1 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
          @click="toggleTrace"
        >
          <UIcon
            name="i-lucide-chevron-down"
            class="h-3.5 w-3.5"
          />
        </button>
      </div>
    </section>

    <!-- DVR scrub badge: how far back of "now" we're showing -->
    <div
      v-if="dvrSeconds !== null"
      class="pointer-events-none fixed bottom-32 left-1/2 z-30 -translate-x-1/2 border-y border-zinc-700/60 bg-zinc-950/60 px-6 py-2 font-mono text-sm uppercase tracking-[0.3em] text-zinc-100 backdrop-blur-sm"
    >
      DVR −{{ dvrSeconds.toFixed(1) }}s
      <span class="ml-3 text-[10px] tracking-[0.2em] text-zinc-500">
        {{ pauseSource === 'game' ? 'game paused' : 'manual pause' }}
      </span>
    </div>
  </div>
</template>
