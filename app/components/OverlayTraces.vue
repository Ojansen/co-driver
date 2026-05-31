<script setup lang="ts">
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { alignByDistance, type AlignedSeries, type AlignFrame } from '~/utils/align'
import { formatDelta } from '~/utils/format'

const { format } = useUnits()

export interface OverlayLap {
  frames: AlignFrame[]
  label?: string
  /** Legend / line color (any CSS color). Assigned by the caller's palette. */
  color: string
}

const props = defineProps<{
  /** Ordered list of laps to overlay. `laps[referenceIndex]` is the time
   *  baseline every Δ line is measured against. */
  laps: OverlayLap[]
  /** Index into `laps` of the reference lap. Default 0. */
  referenceIndex?: number
  /** distance bucket step in meters */
  step?: number
}>()

// Sync group key: every plot in this instance shares cursor + x-scale via uPlot.sync.
const uid = Math.random().toString(36).slice(2, 9)
const syncKey = `overlay-${uid}`

const refIdx = computed(() => {
  const i = props.referenceIndex ?? 0
  return i >= 0 && i < props.laps.length ? i : 0
})

const aligned = computed<AlignedSeries[]>(() =>
  props.laps.map(l => alignByDistance(l.frames, props.step ?? 1))
)

// Shared distance domain: the shortest lap so we never extrapolate.
const sharedLen = computed(() => {
  const a = aligned.value
  if (a.length === 0) return 0
  let m = Infinity
  for (const s of a) m = Math.min(m, s.distance.length)
  return m === Infinity ? 0 : m
})

// Shared x-array (distance in meters). alignByDistance puts every lap on the
// same fixed-step grid, so the reference lap's distances index all of them.
const xs = computed<Float64Array>(() => {
  const n = sharedLen.value
  const ref = aligned.value[refIdx.value] ?? aligned.value[0]
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = ref ? ref.distance[i]! : i
  return out
})

// Indices of the laps that get a Δ line — everything except the reference.
const comparisonIdx = computed<number[]>(() =>
  props.laps.map((_, i) => i).filter(i => i !== refIdx.value)
)

// Per-lap delta (lap.elapsedMs − ref.elapsedMs) on the shared grid. Positive =
// this lap is *behind* the reference here. null for the reference itself.
const deltas = computed<(Float64Array | null)[]>(() => {
  const n = sharedLen.value
  const ref = aligned.value[refIdx.value]
  return aligned.value.map((s, idx) => {
    if (idx === refIdx.value || !ref) return null
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) out[i] = s.elapsedMs[i]! - ref.elapsedMs[i]!
    return out
  })
})

// Symmetric y-bound for the delta row, snapped to a "nice" number, taken over
// every comparison lap so they share one scale.
const deltaBoundMs = computed(() => {
  let m = 0
  for (const d of deltas.value) {
    if (!d) continue
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]!)
      if (v > m) m = v
    }
  }
  if (m === 0) return 1000
  const nice = [250, 500, 1000, 2000, 5000, 10000, 30000]
  for (const n of nice) if (m <= n) return n
  return Math.ceil(m / 1000) * 1000
})

function finalDelta(idx: number): number {
  const d = deltas.value[idx]
  const n = sharedLen.value
  return d && n > 0 ? d[n - 1]! : 0
}

// --- Row definitions -----------------------------------------------------
// Each entry becomes one synced uPlot instance. Δ TIME leads the stack and
// gets double height — it's the headline channel, the others are supporting
// inputs the eye drops to when a delta spike calls for an explanation.
type ChannelKey = 'throttle' | 'brake' | 'steer'
type RowKey = ChannelKey | 'delta'
interface Row {
  key: RowKey
  label: string
  fmt: (v: number) => string
  height: number
}
const INPUT_ROW_H = 90
const DELTA_ROW_H = INPUT_ROW_H * 2
const rows: Row[] = [
  { key: 'delta', label: 'Δ TIME', fmt: v => formatDelta(v) + 's', height: DELTA_ROW_H },
  { key: 'throttle', label: 'THROTL', fmt: v => Math.round(v * 100) + '%', height: INPUT_ROW_H },
  { key: 'brake', label: 'BRAKE', fmt: v => Math.round(v * 100) + '%', height: INPUT_ROW_H },
  { key: 'steer', label: 'STEER', fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2), height: INPUT_ROW_H }
]

// --- uPlot lifecycle ------------------------------------------------------
const plotEls = ref<HTMLDivElement[]>([])
const plots: uPlot[] = []
let resizeObs: ResizeObserver | null = null

// Cursor index (synced across plots). null when pointer leaves the strip.
const cursorIdx = ref<number | null>(null)

function f32To64(src: Float32Array, n: number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = src[i]!
  return out
}

function buildData(row: Row): uPlot.AlignedData {
  const n = sharedLen.value
  if (n === 0) return [new Float64Array(0)] as unknown as uPlot.AlignedData
  if (row.key === 'delta') {
    // One series per comparison lap, in comparisonIdx order.
    const series = comparisonIdx.value.map(i => deltas.value[i] ?? new Float64Array(n))
    return [xs.value, ...series] as unknown as uPlot.AlignedData
  }
  // One series per lap, in lap order. Pull the channel key out before the
  // closure so TS keeps the narrowing (it can't see through the arrow fn).
  const key: ChannelKey = row.key
  const series = aligned.value.map(s => f32To64(s[key], n))
  return [xs.value, ...series] as unknown as uPlot.AlignedData
}

function buildOpts(row: Row, isLast: boolean, width: number): uPlot.Options {
  const isDelta = row.key === 'delta'
  const series: uPlot.Series[] = [
    { label: 'd' },
    ...(isDelta
      ? comparisonIdx.value.map(i => ({
          label: props.laps[i]?.label ?? `lap ${i + 1}`,
          stroke: props.laps[i]?.color ?? '#fafafa',
          width: 1.5,
          points: { show: false }
        }))
      : props.laps.map((l, i) => ({
          label: l.label ?? `lap ${i + 1}`,
          stroke: l.color,
          // The reference lap reads a touch heavier so it's findable in the bundle.
          width: i === refIdx.value ? 1.9 : 1.3,
          points: { show: false }
        })))
  ]

  return {
    width,
    height: row.height,
    pxAlign: 0,
    legend: { show: false },
    cursor: {
      // sync across all rows: cursor position + x-scale zoom both propagate.
      sync: { key: syncKey, setSeries: false, scales: ['x', null] as [string | null, string | null] },
      drag: { x: true, y: false, setScale: true },
      points: { show: false }
    },
    select: { show: true, left: 0, top: 0, width: 0, height: 0 },
    axes: [
      {
        stroke: '#71717a',
        grid: { stroke: '#27272a', width: 0.5 },
        ticks: { stroke: '#27272a', width: 0.5, size: 4 },
        font: '9px monospace',
        show: isLast,
        size: isLast ? 22 : 0,
        values: (_u, vals) => vals.map(v => format.distance(v).replace(/\s+/g, ''))
      },
      {
        stroke: '#71717a',
        grid: { stroke: '#27272a', width: 0.5 },
        ticks: { stroke: '#27272a', width: 0.5, size: 4 },
        font: '9px monospace',
        size: 44,
        values: (_u, vals) => vals.map((v) => {
          if (isDelta) return (v / 1000).toFixed(Math.abs(v) >= 1000 ? 0 : 1) + 's'
          if (row.key === 'steer') return v.toFixed(1)
          return Math.round(v * 100) + '%'
        })
      }
    ],
    scales: {
      x: { time: false },
      y: isDelta
        ? { range: () => [-deltaBoundMs.value, deltaBoundMs.value] }
        : row.key === 'steer'
          ? { range: () => [-1, 1] }
          : { range: () => [0, 1] }
    },
    series,
    hooks: {
      setCursor: [
        (u: uPlot) => {
          const idx = u.cursor.idx
          cursorIdx.value = (idx === undefined || idx === null) ? null : idx
        }
      ],
      draw: isDelta ? [drawDeltaZeroLine] : (row.key === 'steer' ? [drawSteerZeroLine] : [])
    }
  }
}

// Mid-line at zero for steer and delta rows: drawn directly on the canvas
// so it sits behind the trace but ahead of the grid. On the delta row the
// zero line *is* the reference lap (every Δ is measured against it).
function drawSteerZeroLine(u: uPlot): void {
  drawHorizontalLine(u, 0, '#3f3f46')
}
function drawDeltaZeroLine(u: uPlot): void {
  drawHorizontalLine(u, 0, '#52525b')
}
function drawHorizontalLine(u: uPlot, yVal: number, color: string): void {
  const ctx = u.ctx
  const py = u.valToPos(yVal, 'y', true)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 0.5
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(u.bbox.left, py)
  ctx.lineTo(u.bbox.left + u.bbox.width, py)
  ctx.stroke()
  ctx.restore()
}

function renderPlots(): void {
  destroyPlots()
  if (sharedLen.value === 0) return
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const el = plotEls.value[i]
    if (!el) continue
    const w = el.clientWidth || 1000
    plots[i] = new uPlot(buildOpts(row, i === rows.length - 1, w), buildData(row), el)
  }
}

function destroyPlots(): void {
  for (const p of plots) p?.destroy()
  plots.length = 0
}

function resetZoom(): void {
  if (sharedLen.value === 0) return
  const min = xs.value[0] ?? 0
  const max = xs.value[sharedLen.value - 1] ?? 0
  // cursor.sync only propagates cursor + drag-zoom — a programmatic
  // setScale fires only on the target plot, so loop over the group.
  for (const p of plots) p?.setScale('x', { min, max })
}

onMounted(() => {
  renderPlots()
  resizeObs = new ResizeObserver(() => {
    for (let i = 0; i < plots.length; i++) {
      const p = plots[i]
      const el = plotEls.value[i]
      const row = rows[i]
      if (!p || !el || !row) continue
      const w = el.clientWidth
      if (w > 0) p.setSize({ width: w, height: row.height })
    }
  })
  for (const el of plotEls.value) resizeObs.observe(el)
})

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  destroyPlots()
})

// Rebuild when the data identity changes — sharedLen captures lap add/remove,
// xs identity captures step/reference change, laps.length + refIdx capture a
// palette/reference reassignment that doesn't move sharedLen.
watch([sharedLen, xs, () => props.laps.length, refIdx], () => {
  nextTick(() => renderPlots())
})

// --- Hover-value pills ----------------------------------------------------
interface HoverLap {
  color: string
  label: string
  isRef: boolean
  throttle: number
  brake: number
  steer: number
  delta: number | null
}
interface HoverValues {
  distance: number
  laps: HoverLap[]
}
const hoverValues = computed<HoverValues | null>(() => {
  const i = cursorIdx.value
  if (i === null || i < 0 || i >= sharedLen.value) return null
  return {
    distance: xs.value[i]!,
    laps: props.laps.map((l, idx) => {
      const s = aligned.value[idx]!
      const d = deltas.value[idx]
      return {
        color: l.color,
        label: l.label ?? `lap ${idx + 1}`,
        isRef: idx === refIdx.value,
        throttle: s.throttle[i]!,
        brake: s.brake[i]!,
        steer: s.steer[i]!,
        delta: d ? d[i]! : null
      }
    })
  }
})

function hoverValue(row: Row, lap: HoverLap): string | null {
  if (row.key === 'delta') return lap.delta === null ? null : row.fmt(lap.delta)
  const key: ChannelKey = row.key
  return row.fmt(lap[key])
}
</script>

<template>
  <section class="panel p-4 font-mono text-zinc-100 backdrop-blur">
    <header class="mb-3 flex flex-wrap items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
      <span class="flex items-center gap-3">
        <span>traces · by distance</span>
        <span
          v-if="hoverValues"
          class="rounded bg-zinc-800/80 px-1.5 py-0.5 normal-case tracking-normal text-zinc-200 tabular-nums"
        >
          @ {{ format.distance(hoverValues.distance).replace(/\s+/g, '') }}
        </span>
        <button
          v-if="sharedLen > 0"
          type="button"
          class="rounded border border-zinc-700 px-1.5 py-0.5 normal-case tracking-normal text-zinc-300 hover:bg-zinc-800"
          :title="'Reset zoom (or double-click any row)'"
          @click="resetZoom"
        >
          reset zoom
        </button>
      </span>
      <!-- Legend: one swatch per lap; the reference lap (the Δ baseline) is
           tagged, and each comparison lap shows its finish-line Δ. -->
      <span class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span
          v-for="(l, i) in laps"
          :key="i"
          class="flex items-center gap-1.5"
          :class="i === refIdx ? 'text-zinc-200' : 'text-zinc-400'"
        >
          <span
            class="inline-block h-1.5 w-3"
            :style="{ background: l.color }"
          />
          <span class="normal-case tracking-normal">{{ l.label ?? `lap ${i + 1}` }}</span>
          <span
            v-if="i === refIdx"
            class="rounded bg-zinc-700/60 px-1 text-[9px] tracking-[0.15em] text-zinc-200"
          >ref</span>
          <span
            v-else
            class="tabular-nums"
            :style="{ color: l.color }"
          >{{ formatDelta(finalDelta(i)) }}s</span>
        </span>
      </span>
    </header>

    <p class="mb-2 text-[10px] text-zinc-600">
      Δ vs reference · above zero = slower than ref · drag to zoom · double-click to reset · move pointer to scrub
    </p>

    <div
      v-if="sharedLen === 0"
      class="py-12 text-center text-xs text-zinc-500"
    >
      No overlapping distance — laps have no comparable range.
    </div>
    <div
      v-else
      class="space-y-0.5"
    >
      <div
        v-for="(row, i) in rows"
        :key="row.key"
        class="relative"
      >
        <span class="pointer-events-none absolute left-12 top-1 z-10 text-[9px] uppercase tracking-[0.2em] text-zinc-500">
          {{ row.label }}<template v-if="row.key === 'delta'">
            · ±{{ (deltaBoundMs / 1000).toFixed(deltaBoundMs >= 1000 ? 0 : 1) }}s
          </template>
        </span>
        <span
          v-if="hoverValues"
          class="pointer-events-none absolute right-1 top-1 z-10 flex flex-wrap justify-end gap-1 text-[10px] tabular-nums"
        >
          <template
            v-for="(lap, li) in hoverValues.laps"
            :key="li"
          >
            <span
              v-if="hoverValue(row, lap) !== null"
              class="rounded px-1.5 py-0.5"
              :style="{ background: lap.color + '20', color: lap.color }"
            >
              {{ hoverValue(row, lap) }}
            </span>
          </template>
        </span>
        <div
          ref="plotEls"
          class="overlay-plot w-full"
          :style="{ height: (i === rows.length - 1 ? row.height + 22 : row.height) + 'px' }"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.overlay-plot :deep(.u-axis) {
  color: #71717a;
}
.overlay-plot :deep(.u-legend) {
  display: none;
}
.overlay-plot :deep(.u-select) {
  background: rgba(34, 211, 238, 0.12);
  border: 1px solid rgba(34, 211, 238, 0.4);
}
.overlay-plot :deep(.u-cursor-x),
.overlay-plot :deep(.u-cursor-y) {
  border-color: rgba(250, 250, 250, 0.5);
}
</style>
