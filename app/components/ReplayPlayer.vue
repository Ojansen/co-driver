<script setup lang="ts">
import type { Telemetry } from '../../server/utils/decode'
import { TRACE_BUFFER_SIZE } from '~/utils/trace'
import { INPUT_TRACE_LINES, motorTraceLines } from '~/utils/trace-lines'
import { emptyDynoState, ingestFrame, snapshot, type DynoCurve as Curve } from '~/utils/dyno'
import { pointsFromFrames } from '~/utils/track-map'
import { detectTrailBraking, trailBrakingBands } from '~/utils/trail-braking'
import { damperHistogramsForLap, damperScatterForLap } from '~/utils/damper-velocity'
import { rideHeightHistogramsForLap } from '~/utils/ride-height'
import { rpmDistribution, slipAngleBalanceDistribution } from '~/utils/channel-distributions'

const { format } = useUnits()

const props = defineProps<{
  frames: Telemetry[]
}>()

const {
  currentFrame,
  currentIndex,
  history,
  playing,
  playbackRate,
  totalMs,
  elapsedMs,
  toggle,
  pause,
  seekToIndex,
  seekToFraction
} = useReplay(props.frames)

const scrubFraction = computed({
  get(): number {
    if (totalMs.value <= 0) return 0
    return elapsedMs.value / totalMs.value
  },
  set(f: number) {
    seekToFraction(f)
  }
})

function formatTime(ms: number): string {
  const totalSeconds = ms / 1000
  const m = Math.floor(totalSeconds / 60)
  const s = (totalSeconds - m * 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}

function onScrub(e: Event) {
  const target = e.target as HTMLInputElement
  pause()
  seekToFraction(Number(target.value))
}

// TraceStrip click maps to a lap-frame index. The strip's history is a
// sliding window ending at currentIndex; sample N in the window corresponds
// to lap frame `start + N` where start is max(0, currentIndex+1 - BUFFER).
function onTraceScrub(scrubBufferIdx: number | null) {
  if (scrubBufferIdx === null) return // snap-to-right-edge is a no-op in replay
  pause()
  const end = currentIndex.value + 1
  const start = Math.max(0, end - TRACE_BUFFER_SIZE)
  seekToIndex(start + scrubBufferIdx)
}

const RATES = [0.25, 0.5, 1, 2, 4] as const

function pickTickStep(totalS: number): number {
  if (totalS <= 10) return 1
  if (totalS <= 30) return 5
  if (totalS <= 90) return 10
  if (totalS <= 300) return 30
  return 60
}

function formatTick(s: number): string {
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const r = Math.round(s - m * 60)
  return r === 0 ? `${m}m` : `${m}:${r.toString().padStart(2, '0')}`
}

const timeTicks = computed(() => {
  const totalS = totalMs.value / 1000
  if (totalS <= 0) return [] as { percent: number, label: string }[]
  const step = pickTickStep(totalS)
  const ticks: { percent: number, label: string }[] = []
  // Stop one step short of total to avoid colliding with the trailing total label.
  const stop = totalS - step * 0.5
  for (let s = 0; s <= stop; s += step) {
    ticks.push({ percent: (s / totalS) * 100, label: formatTick(s) })
  }
  // Always pin the lap-end label at the right edge.
  ticks.push({ percent: 100, label: formatTick(totalS) })
  return ticks
})

function tickAnchorClass(percent: number): string {
  if (percent < 1) return 'left-0'
  if (percent > 99) return 'right-0'
  return '-translate-x-1/2'
}

function tickStyle(percent: number): Record<string, string> {
  if (percent < 1 || percent > 99) return {}
  return { left: percent + '%' }
}

// Same window-max approach as /live so the motor strip auto-scales as you
// scrub through the lap. The scales drift naturally with the visible window.
const motorLines = computed(() => {
  const h = history.value
  let mTq = 0
  let mPw = 0
  for (let i = 0; i < h.length; i++) {
    const s = h[i]!
    if (s.torqueNm > mTq) mTq = s.torqueNm
    if (s.powerKw > mPw) mPw = s.powerKw
  }
  return motorTraceLines({ maxTorqueNm: mTq, maxPowerKw: mPw }, { torque: format.torque, power: format.power })
})

// Dyno curve grows as the lap plays. Re-binning props.frames.slice(0, end)
// every tick was O(n) per frame → O(n²) over the lap, and the per-tick cost
// climbed as the slice grew (visible stutter late in long laps). Instead keep
// a streaming DynoState and ingest only the frames revealed since the last
// tick — amortized O(1) while playing forward. A backward seek or lap change
// can't un-do the running maxes, so those rebuild from scratch up to the
// current point. snapshot() folds the ~RPM-bin buckets and is cheap.
let dynoState = emptyDynoState()
let dynoEnd = 0 // frames [0, dynoEnd) already ingested into dynoState
let dynoFramesRef: Telemetry[] | null = null
const dynoCurve = shallowRef<Curve>(snapshot(dynoState))

watch([() => props.frames, currentIndex], () => {
  const frames = props.frames
  const end = currentIndex.value + 1
  if (frames !== dynoFramesRef || end < dynoEnd) {
    dynoState = emptyDynoState()
    dynoEnd = 0
    dynoFramesRef = frames
  }
  for (let i = dynoEnd; i < end; i++) {
    const f = frames[i]
    if (f) ingestFrame(dynoState, f)
  }
  dynoEnd = end
  dynoCurve.value = snapshot(dynoState)
}, { immediate: true })

// Track-map: compute once from the full lap (route doesn't change as you
// scrub). The moving dot comes from currentFrame.position — no need to
// index back into the downsampled points array.
const trackPoints = computed(() => pointsFromFrames(props.frames))

const trackCursor = computed(() => {
  const f = currentFrame.value
  if (!f || !f.position) return null
  // Skip the (0, 0, 0) loading frames the game emits before the car is
  // positioned — same filter `pointsFromFrames` uses. Without this, scrubbing
  // back into the loading region parks the cursor off-map at world origin.
  if (f.position.x === 0 && f.position.z === 0) return null
  return {
    x: f.position.x,
    z: f.position.z,
    y: f.position.y,
    distance: f.lap?.distance ?? 0
  }
})

// Click-to-seek on the map: find the frame whose world position is nearest the
// clicked point and jump the replay there. Skips (0, 0) loading-screen frames.
function onMapSeek(point: { x: number, z: number }) {
  const frames = props.frames
  if (frames.length === 0) return
  let bestIdx = -1
  let bestDist = Infinity
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!
    const px = f.position?.x
    const pz = f.position?.z
    if (px === undefined || pz === undefined) continue
    if (px === 0 && pz === 0) continue
    const dx = px - point.x
    const dz = pz - point.z
    const d2 = dx * dx + dz * dz
    if (d2 < bestDist) {
      bestDist = d2
      bestIdx = i
    }
  }
  if (bestIdx < 0) return
  pause()
  seekToIndex(bestIdx)
}

// Per-corner damper velocity histograms — whole-lap aggregate. Computed once
// from props.frames (no scrub interaction); the histogram shape *is* the
// measurement, so it stays static while the rest of the panel scrubs.
const damperHistograms = computed(() => damperHistogramsForLap(props.frames))

// Position-domain suspension companions, same whole-lap aggregate: where the
// chassis sits (ride-height histogram) and how bump/rebound couples with travel
// (damper position×velocity scatter).
const rideHeightHistograms = computed(() => rideHeightHistogramsForLap(props.frames))
const damperScatter = computed(() => damperScatterForLap(props.frames))

// Engine and chassis-balance distributions over the whole lap. RPM pairs with
// the dyno (engine output × where time was spent); slip-angle balance is the
// lap-scale understeer/oversteer read no per-frame view answers.
const rpmHistogram = computed(() => rpmDistribution(props.frames))
const slipAngleBalance = computed(() => slipAngleBalanceDistribution(props.frames))

// Trail-braking bands across the full lap. The replay-strip "history" is a
// sliding window of the full lap; the bands need to be remapped from full-
// lap indices into history-window indices each render.
const trailBrakeFlagsFull = computed(() => detectTrailBraking(props.frames))

const trailBrakingBandsReplay = computed(() => {
  // The replay's history slice runs from `start = max(0, currentIndex+1 - BUFFER)`
  // through `currentIndex`. Same math as `onTraceScrub` in this file.
  const end = currentIndex.value + 1
  const start = Math.max(0, end - TRACE_BUFFER_SIZE)
  const sliced = trailBrakeFlagsFull.value.slice(start, end)
  return trailBrakingBands(sliced)
})
</script>

<template>
  <div class="card p-4">
    <header class="mb-3 flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <span class="flex items-center gap-3">
        <span>Replay · {{ frames.length }} frames</span>
        <NuxtLink
          to="/manual/replay"
          class="inline-flex items-center gap-1 normal-case tracking-normal hover:text-green-300"
          title="How to read the graphs on this page"
        >
          <UIcon
            name="i-lucide-book-open"
            class="h-3 w-3"
          />
          <span>manual</span>
        </NuxtLink>
      </span>
      <span class="tabular-nums text-zinc-300">
        {{ formatTime(elapsedMs) }} / {{ formatTime(totalMs) }}
      </span>
    </header>

    <CornerView
      :frame="currentFrame"
      :paused="false"
    />

    <section class="space-y-3 px-6 pb-2">
      <!-- 3D chassis attitude — replay-only because the WebGL canvas is the
           heavy visualization in this set. CornerView's center column shows
           inputs + attitude readouts and the G-G dot instead. -->
      <div class="card aspect-[16/10] overflow-hidden p-2 sm:p-3">
        <CarAttitude3D :frame="currentFrame" />
      </div>
      <TraceStrip
        :history="history"
        :lines="INPUT_TRACE_LINES"
        label="traces · replay window"
        :paused="!playing"
        :scrubbable="true"
        :drag-scrub="false"
        :scrub-index="null"
        :buffer-length="history.length"
        :bands="trailBrakingBandsReplay"
        @toggle-pause="toggle"
        @scrub="onTraceScrub"
      />
      <TraceStrip
        :history="history"
        :lines="motorLines"
        label="motor · replay window"
        :paused="!playing"
        :scrubbable="true"
        :drag-scrub="false"
        :scrub-index="null"
        :buffer-length="history.length"
        :show-pause-button="false"
        @scrub="onTraceScrub"
      />
      <DynoCurve
        :curve="dynoCurve"
        title="dyno · this lap so far"
        mode="detailed"
        :current-rpm="currentFrame?.rpm ?? 0"
      />
      <ChannelHistogram
        :histogram="rpmHistogram"
        title="time at rpm · whole lap"
        unit="rpm"
      />
      <SuspensionHistogram
        :histograms="damperHistograms"
        title="damper velocity · whole lap"
      />
      <DamperScatter
        :scatter="damperScatter"
        title="damper position × velocity · whole lap"
      />
      <RideHeightHistogram
        :histograms="rideHeightHistograms"
        title="ride height · whole lap"
      />
      <ChannelHistogram
        :histogram="slipAngleBalance"
        title="balance · front − rear slip angle · whole lap"
        subtitle="cornering only"
        unit="°"
        :signed="true"
        left-label="oversteer"
        right-label="understeer"
      />
      <TrackMap
        :points="trackPoints"
        :current-point="trackCursor"
        :seekable="true"
        title="track · this lap"
        @seek-to-position="onMapSeek"
      />
    </section>

    <div class="sticky bottom-0 z-10 -mx-4 -mb-4 mt-2 flex items-center gap-3 border-t border-zinc-800 bg-zinc-950/90 px-6 py-3 backdrop-blur">
      <button
        type="button"
        class="rounded-sm border border-zinc-700 bg-zinc-900 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-green-500/60 hover:text-green-300"
        @click="toggle"
      >
        {{ playing ? '❚❚ Pause' : '▶ Play' }}
      </button>
      <div class="flex flex-1 flex-col gap-0.5">
        <input
          :value="scrubFraction"
          type="range"
          min="0"
          max="1"
          step="0.001"
          class="w-full accent-green-400"
          @input="onScrub"
        >
        <div
          v-if="timeTicks.length > 0"
          class="relative h-3 select-none font-mono text-[9px] tabular-nums text-zinc-500"
        >
          <span
            v-for="tick in timeTicks"
            :key="tick.percent"
            class="absolute top-0"
            :class="tickAnchorClass(tick.percent)"
            :style="tickStyle(tick.percent)"
          >{{ tick.label }}</span>
        </div>
      </div>
      <select
        v-model.number="playbackRate"
        class="rounded-sm border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-200"
      >
        <option
          v-for="r in RATES"
          :key="r"
          :value="r"
        >
          {{ r }}x
        </option>
      </select>
    </div>
  </div>
</template>
