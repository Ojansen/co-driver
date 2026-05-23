<script setup lang="ts">
import { alignByDistance, type AlignedSeries, type AlignFrame } from '~/utils/align'
import { formatDelta } from '~/utils/format'

const { format } = useUnits()

const props = defineProps<{
  framesA: AlignFrame[]
  framesB: AlignFrame[]
  labelA?: string
  labelB?: string
  /** distance bucket step in meters */
  step?: number
}>()

const COLOR_A = '#fafafa'
const COLOR_B = '#fbbf24'
const COLOR_DELTA_A_AHEAD = '#22c55e'
const COLOR_DELTA_B_AHEAD = '#f59e0b'

// Generate a unique-enough id for clip-paths so multiple instances coexist.
const uid = Math.random().toString(36).slice(2, 9)

const a = computed<AlignedSeries>(() => alignByDistance(props.framesA, props.step ?? 1))
const b = computed<AlignedSeries>(() => alignByDistance(props.framesB, props.step ?? 1))

// Shared distance domain: the shorter of the two so we don't extrapolate.
const sharedLen = computed(() => Math.min(a.value.distance.length, b.value.distance.length))
const dMax = computed(() => sharedLen.value > 0 ? a.value.distance[sharedLen.value - 1]! : 0)

// Delta (B.elapsedMs - A.elapsedMs) per shared bucket. Positive = A is ahead.
const delta = computed<Float32Array>(() => {
  const n = sharedLen.value
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = b.value.elapsedMs[i]! - a.value.elapsedMs[i]!
  }
  return out
})

// Symmetric y-bound for the delta row, snapped to a "nice" number.
const deltaBoundMs = computed(() => {
  let m = 0
  const d = delta.value
  for (let i = 0; i < d.length; i++) {
    const v = Math.abs(d[i]!)
    if (v > m) m = v
  }
  if (m === 0) return 1000
  const nice = [250, 500, 1000, 2000, 5000, 10000, 30000]
  for (const n of nice) if (m <= n) return n
  return Math.ceil(m / 1000) * 1000
})

// Layout: one tall SVG with stacked rows.
const VIEW_W = 1000
const ROW_H = 84
const ROW_GAP = 4
const PAD_T = 10
const PAD_B = 22
const ROWS = 4
const VIEW_H = PAD_T + ROW_H * ROWS + ROW_GAP * (ROWS - 1) + PAD_B

function rowTop(i: number): number {
  return PAD_T + i * (ROW_H + ROW_GAP)
}

function pathFor(values: Float32Array, count: number, norm: (v: number) => number, top: number): string {
  if (count < 2 || dMax.value <= 0) return ''
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = (a.value.distance[i]! / dMax.value) * VIEW_W
    const y = top + norm(values[i]!) * ROW_H
    out += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' '
  }
  return out.trim()
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

const pathThrottleA = computed(() => pathFor(a.value.throttle, sharedLen.value, v => 1 - clamp01(v), rowTop(0)))
const pathThrottleB = computed(() => pathFor(b.value.throttle, sharedLen.value, v => 1 - clamp01(v), rowTop(0)))
const pathBrakeA = computed(() => pathFor(a.value.brake, sharedLen.value, v => 1 - clamp01(v), rowTop(1)))
const pathBrakeB = computed(() => pathFor(b.value.brake, sharedLen.value, v => 1 - clamp01(v), rowTop(1)))
const pathSteerA = computed(() => pathFor(a.value.steer, sharedLen.value, v => 0.5 - clamp(v, -1, 1) / 2, rowTop(2)))
const pathSteerB = computed(() => pathFor(b.value.steer, sharedLen.value, v => 0.5 - clamp(v, -1, 1) / 2, rowTop(2)))

const pathDelta = computed(() => {
  return pathFor(delta.value, sharedLen.value, v => 0.5 - clamp(v, -deltaBoundMs.value, deltaBoundMs.value) / (deltaBoundMs.value * 2), rowTop(3))
})

const finalDeltaMs = computed(() => {
  const n = sharedLen.value
  return n > 0 ? delta.value[n - 1]! : 0
})

const steerMidY = computed(() => rowTop(2) + ROW_H / 2)
const deltaMidY = computed(() => rowTop(3) + ROW_H / 2)

// Distance tick positions: every ~1km, snapped, with labels in km when >=1000.
const distanceTicks = computed(() => {
  if (dMax.value <= 0) return [] as { x: number, label: string }[]
  const total = dMax.value
  const niceSteps = [100, 250, 500, 1000, 2000, 5000]
  const target = total / 6
  let step = niceSteps[niceSteps.length - 1]!
  for (const s of niceSteps) {
    if (s >= target) {
      step = s
      break
    }
  }
  const out: { x: number, label: string }[] = []
  for (let d = step; d < total; d += step) {
    out.push({
      x: (d / total) * VIEW_W,
      label: format.distance(d).replace(/\s+/g, '')
    })
  }
  return out
})

const clipAboveId = `overlay-above-${uid}`
const clipBelowId = `overlay-below-${uid}`
</script>

<template>
  <section class="panel p-4 font-mono text-zinc-100 backdrop-blur">
    <header class="mb-3 flex flex-wrap items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
      <span>traces · by distance</span>
      <span class="flex flex-wrap items-center gap-4">
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block h-1.5 w-3"
            :style="{ background: COLOR_A }"
          />A {{ labelA ? '· ' + labelA : '' }}
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block h-1.5 w-3"
            :style="{ background: COLOR_B }"
          />B {{ labelB ? '· ' + labelB : '' }}
        </span>
        <span class="flex items-center gap-1.5">
          <span class="text-zinc-500">Δ at finish</span>
          <span
            class="rounded px-1.5 py-0.5 tabular-nums"
            :style="{
              background: finalDeltaMs > 0 ? COLOR_DELTA_A_AHEAD + '20' : COLOR_DELTA_B_AHEAD + '20',
              color: finalDeltaMs > 0 ? COLOR_DELTA_A_AHEAD : COLOR_DELTA_B_AHEAD
            }"
          >
            {{ formatDelta(finalDeltaMs) }} s
          </span>
        </span>
      </span>
    </header>

    <div class="relative">
      <svg
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        class="w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <clipPath :id="clipAboveId">
            <rect
              x="0"
              :y="rowTop(3)"
              :width="VIEW_W"
              :height="ROW_H / 2"
            />
          </clipPath>
          <clipPath :id="clipBelowId">
            <rect
              x="0"
              :y="deltaMidY"
              :width="VIEW_W"
              :height="ROW_H / 2"
            />
          </clipPath>
        </defs>

        <!-- Row backgrounds + bottom borders to separate signals -->
        <g
          v-for="r in ROWS"
          :key="r"
        >
          <line
            x1="0"
            :y1="rowTop(r - 1) + ROW_H"
            :x2="VIEW_W"
            :y2="rowTop(r - 1) + ROW_H"
            stroke="#27272a"
            stroke-width="0.5"
          />
        </g>

        <!-- Row 3 (steer) midline = zero -->
        <line
          x1="0"
          :y1="steerMidY"
          :x2="VIEW_W"
          :y2="steerMidY"
          stroke="#3f3f46"
          stroke-width="0.5"
          stroke-dasharray="3,3"
        />
        <!-- Row 4 (delta) midline = zero -->
        <line
          x1="0"
          :y1="deltaMidY"
          :x2="VIEW_W"
          :y2="deltaMidY"
          stroke="#3f3f46"
          stroke-width="0.5"
          stroke-dasharray="3,3"
        />

        <!-- Distance tick verticals -->
        <g
          v-for="(t, i) in distanceTicks"
          :key="`tick-${i}`"
        >
          <line
            :x1="t.x"
            :y1="PAD_T"
            :x2="t.x"
            :y2="VIEW_H - PAD_B"
            stroke="#27272a"
            stroke-width="0.5"
          />
        </g>

        <!-- Throttle row -->
        <path
          :d="pathThrottleA"
          fill="none"
          :stroke="COLOR_A"
          stroke-width="1.4"
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity="0.9"
        />
        <path
          :d="pathThrottleB"
          fill="none"
          :stroke="COLOR_B"
          stroke-width="1.4"
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity="0.9"
        />

        <!-- Brake row -->
        <path
          :d="pathBrakeA"
          fill="none"
          :stroke="COLOR_A"
          stroke-width="1.4"
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity="0.9"
        />
        <path
          :d="pathBrakeB"
          fill="none"
          :stroke="COLOR_B"
          stroke-width="1.4"
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity="0.9"
        />

        <!-- Steer row -->
        <path
          :d="pathSteerA"
          fill="none"
          :stroke="COLOR_A"
          stroke-width="1.4"
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity="0.9"
        />
        <path
          :d="pathSteerB"
          fill="none"
          :stroke="COLOR_B"
          stroke-width="1.4"
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity="0.9"
        />

        <!-- Delta row: same path clipped above/below zero, colored by who's ahead -->
        <path
          :d="pathDelta"
          fill="none"
          :stroke="COLOR_DELTA_A_AHEAD"
          stroke-width="1.8"
          stroke-linejoin="round"
          stroke-linecap="round"
          :clip-path="`url(#${clipAboveId})`"
        />
        <path
          :d="pathDelta"
          fill="none"
          :stroke="COLOR_DELTA_B_AHEAD"
          stroke-width="1.8"
          stroke-linejoin="round"
          stroke-linecap="round"
          :clip-path="`url(#${clipBelowId})`"
        />

        <!-- Row labels (top-left of each row) -->
        <text
          :x="6"
          :y="rowTop(0) + 10"
          fill="#71717a"
          font-size="9"
          font-family="monospace"
        >THROTL</text>
        <text
          :x="6"
          :y="rowTop(1) + 10"
          fill="#71717a"
          font-size="9"
          font-family="monospace"
        >BRAKE</text>
        <text
          :x="6"
          :y="rowTop(2) + 10"
          fill="#71717a"
          font-size="9"
          font-family="monospace"
        >STEER</text>
        <text
          :x="6"
          :y="rowTop(3) + 10"
          fill="#71717a"
          font-size="9"
          font-family="monospace"
        >Δ TIME · ±{{ (deltaBoundMs / 1000).toFixed(deltaBoundMs >= 1000 ? 0 : 1) }}s</text>

        <!-- Distance tick labels -->
        <text
          v-for="(t, i) in distanceTicks"
          :key="`tlbl-${i}`"
          :x="t.x"
          :y="VIEW_H - 6"
          text-anchor="middle"
          fill="#71717a"
          font-size="9"
          font-family="monospace"
        >{{ t.label }}</text>
        <text
          :x="0"
          :y="VIEW_H - 6"
          text-anchor="start"
          fill="#71717a"
          font-size="9"
          font-family="monospace"
        >0</text>
        <text
          :x="VIEW_W"
          :y="VIEW_H - 6"
          text-anchor="end"
          fill="#71717a"
          font-size="9"
          font-family="monospace"
        >{{ format.distance(dMax).replace(/\s+/g, '') }}</text>
      </svg>

      <div
        v-if="sharedLen === 0"
        class="absolute inset-0 flex items-center justify-center text-xs text-zinc-500"
      >
        No overlapping distance — laps have no comparable range.
      </div>
    </div>
  </section>
</template>
