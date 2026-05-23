<script setup lang="ts">
import {
  boundsFromTraces,
  svgYFromWorldZ,
  worldZFromSvgY,
  type TrackBounds,
  type TrackPoint
} from '~/utils/track-map'

const { format } = useUnits()

export interface TrackTrace {
  points: TrackPoint[]
  label?: string
  /** Highlights this trace (brighter, thicker line). Typically the best lap. */
  best?: boolean
}

const props = withDefaults(defineProps<{
  /** Single-trace input — convenience for replay. Either `points` or `traces` must be set. */
  points?: TrackPoint[]
  /** Multi-trace input — for session-detail overlay. */
  traces?: TrackTrace[]
  title?: string
  subtitle?: string
  /** Live position for the moving dot (replay only). Caller passes the current
   *  frame's position + distance; cleaner than indexing because the points
   *  array is downsampled and filtered. */
  currentPoint?: { x: number, z: number, y: number, distance: number } | null
  /** When true, clicking the map emits `seek-to-position` with world (x, z).
   *  The parent translates that to a frame index and seeks. Replay-only. */
  seekable?: boolean
}>(), {
  points: () => [],
  traces: () => [],
  title: 'track',
  subtitle: '',
  currentPoint: null,
  seekable: false
})

const emit = defineEmits<{
  seekToPosition: [point: { x: number, z: number }]
}>()

const mapSvgRef = ref<SVGSVGElement | null>(null)

function onMapClick(e: MouseEvent) {
  if (!props.seekable) return
  const svg = mapSvgRef.value
  if (!svg) return
  const ctm = svg.getScreenCTM()
  if (!ctm) return
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const local = pt.matrixTransform(ctm.inverse())
  // Reverse-map SVG y back to world Z (see `svgYFromWorldZ` for the forward
  // direction used by every line/circle in the top-down map below).
  emit('seekToPosition', { x: local.x, z: worldZFromSvgY(local.y) })
}

type ColorMode = 'speed' | 'throttle' | 'brake' | 'drivingLine'
const colorMode = ref<ColorMode>('speed')

// Normalise into a single shape for rendering
const allTraces = computed<TrackTrace[]>(() => {
  if (props.traces.length > 0) return props.traces
  if (props.points.length > 0) return [{ points: props.points, best: true }]
  return []
})

const isEmpty = computed(() => {
  for (const t of allTraces.value) if (t.points.length > 0) return false
  return true
})

const bestTrace = computed<TrackTrace | null>(() => {
  const list = allTraces.value
  if (list.length === 0) return null
  // Honor explicit `best` flag; fall back to the first trace.
  return list.find(t => t.best) ?? list[0]!
})

const bounds = computed<TrackBounds>(() => boundsFromTraces(allTraces.value))

const hasDrivingLine = computed(() => {
  for (const t of allTraces.value) {
    for (const p of t.points) {
      if (p.drivingLine !== null) return true
    }
  }
  return false
})

// --- Map geometry ---------------------------------------------------------

const MAP_VIEW_H = 600

const mapViewBox = computed(() => {
  const b = bounds.value
  const w = Math.max(b.maxX - b.minX, 1)
  const h = Math.max(b.maxZ - b.minZ, 1)
  const pad = Math.max(w, h) * 0.05
  // World Z range [minZ, maxZ] maps to SVG y range [-maxZ, -minZ] via
  // `svgYFromWorldZ`. The viewBox origin is therefore `-maxZ`, with the
  // same positive height.
  return `${b.minX - pad} ${svgYFromWorldZ(b.maxZ) - pad} ${w + pad * 2} ${h + pad * 2}`
})

// Stroke widths need to scale with world units (the viewBox), not pixels.
// A track ~3000 units across at MAP_VIEW_W = 1000 px → ~3 units per pixel.
// Pick widths in world units that look ~1–2 px wide at typical track sizes.
const strokeBase = computed(() => {
  const b = bounds.value
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ)
  return Math.max(span / 400, 1) // ~2.5 units at span 1000
})

// --- Color ramp -----------------------------------------------------------

const GREEN = '#22c55e'
const TEAL = '#14b8a6'
const AMBER = '#f59e0b'
const ORANGE = '#f97316'
const RED = '#ef4444'
const ZINC = '#52525b'

function speedColor(kmh: number): string {
  if (kmh > 220) return GREEN
  if (kmh > 160) return TEAL
  if (kmh > 100) return AMBER
  if (kmh > 60) return ORANGE
  return RED
}

function throttleColor(v: number): string {
  if (v > 0.9) return GREEN
  if (v > 0.5) return AMBER
  if (v > 0.1) return ORANGE
  return ZINC
}

function brakeColor(v: number): string {
  if (v > 0.5) return RED
  if (v > 0.2) return ORANGE
  if (v > 0.05) return AMBER
  return ZINC
}

function lineColor(devRaw: number | null): string {
  // raw s8 -128..127; closer to 0 = closer to the AI's optimal line
  if (devRaw === null) return ZINC
  const abs = Math.abs(devRaw)
  if (abs < 10) return GREEN
  if (abs < 25) return TEAL
  if (abs < 50) return AMBER
  if (abs < 80) return ORANGE
  return RED
}

function colorFor(p: TrackPoint): string {
  switch (colorMode.value) {
    case 'throttle': return throttleColor(p.throttle)
    case 'brake': return brakeColor(p.brake)
    case 'drivingLine': return lineColor(p.drivingLine)
    case 'speed':
    default: return speedColor(p.speed)
  }
}

// --- Segment generation ---------------------------------------------------

interface Segment {
  x1: number
  z1: number
  x2: number
  z2: number
  color: string
}

function segmentsFor(points: TrackPoint[]): Segment[] {
  const out: Segment[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    out.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, color: colorFor(b) })
  }
  return out
}

// Best-trace segments are colored; other traces render as faint backdrops.
const bestSegments = computed(() => bestTrace.value ? segmentsFor(bestTrace.value.points) : [])

const backdropTraces = computed(() => {
  const best = bestTrace.value
  return allTraces.value.filter(t => t !== best)
})

// --- Current-frame dot ----------------------------------------------------
// `currentPoint` is supplied directly by the caller (see Replay player) — we
// avoid index gymnastics with the downsampled `points` array.

const cursor = computed(() => props.currentPoint)

// --- Elevation strip ------------------------------------------------------

const ELEV_VIEW_W = 1000
const ELEV_VIEW_H = 90
const ELEV_PAD_T = 6
const ELEV_PAD_B = 14
const ELEV_PLOT_H = ELEV_VIEW_H - ELEV_PAD_T - ELEV_PAD_B

function elevX(distance: number): number {
  const b = bounds.value
  const dSpan = Math.max(b.maxDistance - b.minDistance, 1)
  return ((distance - b.minDistance) / dSpan) * ELEV_VIEW_W
}

function elevY(yVal: number): number {
  const b = bounds.value
  const ySpan = Math.max(b.maxY - b.minY, 1)
  const pad = ySpan * 0.05
  const lo = b.minY - pad
  const hi = b.maxY + pad
  return ELEV_PAD_T + (1 - (yVal - lo) / (hi - lo)) * ELEV_PLOT_H
}

const elevDelta = computed(() => bounds.value.maxY - bounds.value.minY)

const elevSegments = computed<Segment[]>(() => {
  const t = bestTrace.value
  if (!t) return []
  const out: Segment[] = []
  for (let i = 1; i < t.points.length; i++) {
    const a = t.points[i - 1]!
    const b = t.points[i]!
    out.push({
      x1: elevX(a.distance), z1: elevY(a.y),
      x2: elevX(b.distance), z2: elevY(b.y),
      color: colorFor(b)
    })
  }
  return out
})

const currentElevX = computed(() => cursor.value ? elevX(cursor.value.distance) : null)
const currentElevY = computed(() => cursor.value ? elevY(cursor.value.y) : null)

// --- Color-mode chips -----------------------------------------------------

const modes: { value: ColorMode, label: string }[] = [
  { value: 'speed', label: 'speed' },
  { value: 'throttle', label: 'throttle' },
  { value: 'brake', label: 'brake' },
  { value: 'drivingLine', label: 'line' }
]

function modeDisabled(m: ColorMode): boolean {
  return m === 'drivingLine' && !hasDrivingLine.value
}
</script>

<template>
  <section class="panel p-4 font-mono text-zinc-100 backdrop-blur">
    <header class="mb-3 flex items-baseline justify-between gap-4 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
      <span>
        {{ title }}
        <span
          v-if="subtitle"
          class="ml-3 normal-case tracking-normal text-zinc-500"
        >{{ subtitle }}</span>
      </span>
      <span class="flex items-center gap-1">
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          :disabled="modeDisabled(m.value)"
          :title="modeDisabled(m.value) ? 'Needs a recording made after the driving-line decoder change' : undefined"
          class="rounded-sm border px-2 py-0.5 text-[10px] tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :class="colorMode === m.value
            ? 'border-green-500/60 bg-green-500/10 text-green-300'
            : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'"
          @click="colorMode = m.value"
        >
          {{ m.label }}
        </button>
      </span>
    </header>

    <div
      v-if="isEmpty"
      class="flex h-72 items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-900/30 text-center font-mono text-xs text-zinc-500"
    >
      No track data yet — record a lap to see the route.
    </div>

    <template v-else>
      <!-- Top-down map -->
      <svg
        ref="mapSvgRef"
        :viewBox="mapViewBox"
        preserveAspectRatio="xMidYMid meet"
        class="block w-full"
        :class="seekable ? 'cursor-pointer' : ''"
        :style="{ height: MAP_VIEW_H * 0.6 + 'px' }"
        @click="onMapClick"
      >
        <!-- Backdrop traces (other laps): faint, single color -->
        <g
          v-for="(t, ti) in backdropTraces"
          :key="`bk-${ti}`"
        >
          <line
            v-for="(seg, si) in segmentsFor(t.points)"
            :key="`bks-${ti}-${si}`"
            :x1="seg.x1"
            :y1="svgYFromWorldZ(seg.z1)"
            :x2="seg.x2"
            :y2="svgYFromWorldZ(seg.z2)"
            stroke="#3f3f46"
            :stroke-width="strokeBase * 1.2"
            stroke-linecap="round"
            opacity="0.5"
          />
        </g>

        <!-- Faint zinc backdrop under the best-lap segments so the route reads -->
        <line
          v-for="(seg, i) in bestSegments"
          :key="`bbk-${i}`"
          :x1="seg.x1"
          :y1="svgYFromWorldZ(seg.z1)"
          :x2="seg.x2"
          :y2="svgYFromWorldZ(seg.z2)"
          stroke="#27272a"
          :stroke-width="strokeBase * 3"
          stroke-linecap="round"
          opacity="0.55"
        />

        <!-- Best-lap colored segments -->
        <line
          v-for="(seg, i) in bestSegments"
          :key="`best-${i}`"
          :x1="seg.x1"
          :y1="svgYFromWorldZ(seg.z1)"
          :x2="seg.x2"
          :y2="svgYFromWorldZ(seg.z2)"
          :stroke="seg.color"
          :stroke-width="strokeBase * 1.6"
          stroke-linecap="round"
          opacity="0.95"
        />

        <!-- Start marker -->
        <circle
          v-if="bestTrace && bestTrace.points.length > 0"
          :cx="bestTrace.points[0]!.x"
          :cy="svgYFromWorldZ(bestTrace.points[0]!.z)"
          :r="strokeBase * 3"
          fill="#22c55e"
          stroke="#0f0f12"
          :stroke-width="strokeBase * 0.5"
        />

        <!-- Current-frame dot (replay) -->
        <circle
          v-if="cursor"
          :cx="cursor.x"
          :cy="svgYFromWorldZ(cursor.z)"
          :r="strokeBase * 3.5"
          fill="#fafafa"
          stroke="#0f0f12"
          :stroke-width="strokeBase * 0.6"
        />
      </svg>

      <!-- Elevation strip -->
      <div class="mt-3 rounded-md border border-zinc-800/80 bg-zinc-950/40 px-3 pt-2 pb-1">
        <div class="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          <span>elevation</span>
          <span class="tabular-nums">Δ {{ format.distance(elevDelta) }}</span>
        </div>
        <svg
          :viewBox="`0 0 ${ELEV_VIEW_W} ${ELEV_VIEW_H}`"
          preserveAspectRatio="none"
          class="block w-full"
          :style="{ height: ELEV_VIEW_H + 'px' }"
        >
          <!-- Baseline + top reference lines -->
          <line
            x1="0"
            :y1="ELEV_PAD_T + ELEV_PLOT_H"
            :x2="ELEV_VIEW_W"
            :y2="ELEV_PAD_T + ELEV_PLOT_H"
            stroke="#27272a"
            stroke-width="0.5"
          />
          <line
            x1="0"
            :y1="ELEV_PAD_T"
            :x2="ELEV_VIEW_W"
            :y2="ELEV_PAD_T"
            stroke="#27272a"
            stroke-width="0.5"
            stroke-dasharray="2,3"
          />

          <!-- Backdrop pass for the elevation shape -->
          <line
            v-for="(seg, i) in elevSegments"
            :key="`ebk-${i}`"
            :x1="seg.x1"
            :y1="seg.z1"
            :x2="seg.x2"
            :y2="seg.z2"
            stroke="#3f3f46"
            stroke-width="2"
            stroke-linecap="round"
            opacity="0.55"
          />

          <!-- Colored elevation segments -->
          <line
            v-for="(seg, i) in elevSegments"
            :key="`elev-${i}`"
            :x1="seg.x1"
            :y1="seg.z1"
            :x2="seg.x2"
            :y2="seg.z2"
            :stroke="seg.color"
            stroke-width="1.4"
            stroke-linecap="round"
            opacity="0.95"
          />

          <!-- Current-frame marker on the elevation strip -->
          <line
            v-if="currentElevX !== null"
            :x1="currentElevX"
            :x2="currentElevX"
            :y1="ELEV_PAD_T"
            :y2="ELEV_PAD_T + ELEV_PLOT_H"
            stroke="#fafafa"
            stroke-width="0.8"
            opacity="0.8"
          />
          <circle
            v-if="currentElevX !== null && currentElevY !== null"
            :cx="currentElevX"
            :cy="currentElevY"
            r="2.5"
            fill="#fafafa"
          />

          <!-- Distance axis label -->
          <text
            x="2"
            :y="ELEV_VIEW_H - 2"
            fill="#52525b"
            font-size="8"
            font-family="monospace"
          >{{ format.distance(0) }}</text>
          <text
            :x="ELEV_VIEW_W - 2"
            :y="ELEV_VIEW_H - 2"
            text-anchor="end"
            fill="#52525b"
            font-size="8"
            font-family="monospace"
          >{{ format.distance(bounds.maxDistance) }}</text>
        </svg>
      </div>
    </template>
  </section>
</template>
