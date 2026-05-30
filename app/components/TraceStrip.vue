<script setup lang="ts">
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { TRACE_BUFFER_SIZE, type TraceSample } from '~/utils/trace'
import type { LineDef } from '~/utils/trace-lines'

const props = withDefaults(defineProps<{
  history: TraceSample[]
  /** Line configuration — see app/utils/trace-lines.ts for the canonical defs. */
  lines: LineDef[]
  /** Header label, e.g. "traces · last 30 s" or "motor · last 30 s". */
  label: string
  paused: boolean
  /** when true, pointer events on the strip emit `scrub` events */
  scrubbable?: boolean
  /** when false, only the initial pointerdown emits a scrub — drags don't.
   * Replay should set this false because seeking re-anchors the strip's
   * window, which makes continuous drag feed back on itself. */
  dragScrub?: boolean
  /** parent-controlled scrub position; renders a vertical playhead line */
  scrubIndex?: number | null
  /** sample count actually in the buffer (≤ TRACE_BUFFER_SIZE); needed for
   * scrub→index mapping when the strip is still filling */
  bufferLength?: number
  /** Render the pause toggle in the header. Stacked second strips suppress it
   * so a single button controls both. */
  showPauseButton?: boolean
  /** Optional shaded background bands by buffer index range. Used by the
   * trail-braking detector to highlight where a behaviour is active. */
  bands?: Array<{ startIdx: number, endIdx: number, color?: string }>
}>(), {
  scrubbable: false,
  dragScrub: true,
  scrubIndex: null,
  bufferLength: 0,
  showPauseButton: true,
  bands: () => []
})

const emit = defineEmits<{
  togglePause: []
  scrub: [index: number | null]
}>()

const STRIP_HEIGHT = 160
const WINDOW_SECONDS = TRACE_BUFFER_SIZE / 60 // 30 s @ 60 Hz fan-out

// --- uPlot data assembly --------------------------------------------------
// uPlot wants column-major aligned data: [xs, ys_line0, ys_line1, …]. To
// avoid allocating fresh typed arrays + walking all 600 samples on every
// 60 Hz push, we keep a ring buffer of pre-normalized values internally:
//
//   write side  → one slot per new sample (O(1) at 60 Hz)
//   read side   → unroll the ring once per setData via typed-array .set()
//
// `props.history` stays the source of truth for everything else (overlays,
// scrub math, latest-pill); the ring is private and only exists so the
// data uPlot reads on each redraw is cheap to produce.
const CAPACITY = TRACE_BUFFER_SIZE
const xsBuf = new Float64Array(CAPACITY)
const xsView = new Float64Array(CAPACITY)
let seriesBuf: Float64Array[] = []
let seriesView: Float64Array[] = []
let lineKeys: Array<keyof TraceSample> = []
let lineNorms: Array<(v: number) => number> = []
let head = 0 // next write slot in [0, CAPACITY)
let count = 0 // valid samples in [0, CAPACITY]
let lastSeenT = -1 // timestamp of the most recently synced sample
let lastHistoryRef: TraceSample[] | null = null

function syncLineMeta(): void {
  const lines = props.lines
  lineKeys = lines.map(l => l.key)
  lineNorms = lines.map(l => l.norm)
  if (seriesBuf.length !== lines.length) {
    seriesBuf = lines.map(() => new Float64Array(CAPACITY))
    seriesView = lines.map(() => new Float64Array(CAPACITY))
  }
}

function writeSlot(i: number, s: TraceSample): void {
  xsBuf[i] = s.t / 1000
  for (let li = 0; li < lineKeys.length; li++) {
    const raw = s[lineKeys[li]!]
    const v = typeof raw === 'number' ? raw : 0
    // line.norm returns 0..1 in SVG-y (0 = top); uPlot is bottom-up,
    // so invert.
    seriesBuf[li]![i] = 1 - lineNorms[li]!(v)
  }
}

function seedFromHistory(): void {
  const h = props.history
  const n = Math.min(h.length, CAPACITY)
  for (let i = 0; i < n; i++) {
    writeSlot(i, h[h.length - n + i]!)
  }
  head = n % CAPACITY
  count = n
  lastSeenT = n > 0 ? h[h.length - 1]!.t : -1
  lastHistoryRef = props.history
}

function appendToRing(s: TraceSample): void {
  writeSlot(head, s)
  head = (head + 1) % CAPACITY
  if (count < CAPACITY) count++
  lastSeenT = s.t
}

function viewData(): uPlot.AlignedData {
  if (count === 0) {
    return [
      xsBuf.subarray(0, 0),
      ...seriesBuf.map(b => b.subarray(0, 0))
    ] as unknown as uPlot.AlignedData
  }
  if (count < CAPACITY) {
    // Fill phase: ring slots [0, count) are already chronological.
    return [
      xsBuf.subarray(0, count),
      ...seriesBuf.map(b => b.subarray(0, count))
    ] as unknown as uPlot.AlignedData
  }
  if (head === 0) {
    // Ring is full and head wrapped exactly to 0 — buf is already
    // chronological end-to-end.
    return [xsBuf, ...seriesBuf] as unknown as uPlot.AlignedData
  }
  // Steady state, ring wrapped: unroll [head..end, 0..head) into view via
  // two typed-array .set() calls per buffer (native memcpy).
  const tail = CAPACITY - head
  xsView.set(xsBuf.subarray(head), 0)
  xsView.set(xsBuf.subarray(0, head), tail)
  for (let li = 0; li < seriesBuf.length; li++) {
    seriesView[li]!.set(seriesBuf[li]!.subarray(head), 0)
    seriesView[li]!.set(seriesBuf[li]!.subarray(0, head), tail)
  }
  return [xsView, ...seriesView] as unknown as uPlot.AlignedData
}

// --- Live anchor + scrub state -------------------------------------------
// Anchor sticks to a sample timestamp so it tracks the underlying data as
// the ring buffer scrolls.
const anchorT = ref<number | null>(null)

const latest = computed<TraceSample | null>(() => {
  return props.history.length > 0 ? props.history[props.history.length - 1] ?? null : null
})

function latestValue(line: LineDef): number {
  const s = latest.value
  if (!s) return 0
  const raw = s[line.key]
  return typeof raw === 'number' ? raw : 0
}

// Map a sample timestamp → nearest buffer index. `history` is time-sorted, so
// a binary search finds it in O(log n) — relevant when an anchor cursor is
// active and this recomputes every frame over the full window (GH #12).
function idxForTimestamp(tMs: number): number | null {
  const h = props.history
  if (h.length === 0) return null
  let lo = 0
  let hi = h.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (h[mid]!.t < tMs) lo = mid + 1
    else hi = mid
  }
  // `lo` is the first sample with t ≥ tMs; pick the nearer of it and its
  // predecessor so we return the closest sample, not just the next one.
  if (lo > 0 && Math.abs(h[lo - 1]!.t - tMs) < Math.abs(h[lo]!.t - tMs)) lo--
  return lo
}

const anchorIdx = computed<number | null>(() => {
  if (anchorT.value === null) return null
  const h = props.history
  if (h.length === 0) return null
  if (h[0]!.t > anchorT.value) return null // scrolled off
  return idxForTimestamp(anchorT.value)
})

const primaryIdx = computed<number | null>(() => {
  if (props.scrubIndex !== null && props.scrubIndex !== undefined) return props.scrubIndex
  if (props.history.length > 0) return props.history.length - 1
  return null
})

const deltaTms = computed<number | null>(() => {
  const a = anchorIdx.value
  const p = primaryIdx.value
  if (a === null || p === null) return null
  const sa = props.history[a]
  const sp = props.history[p]
  if (!sa || !sp) return null
  return sp.t - sa.t
})

function deltaForLine(line: LineDef): string {
  const a = anchorIdx.value
  const p = primaryIdx.value
  if (a === null || p === null) return ''
  const sa = props.history[a]
  const sp = props.history[p]
  if (!sa || !sp) return ''
  const av = typeof sa[line.key] === 'number' ? (sa[line.key] as number) : 0
  const pv = typeof sp[line.key] === 'number' ? (sp[line.key] as number) : 0
  const d = pv - av
  const formatted = line.fmt(d)
  return d > 0 && !formatted.startsWith('+') ? '+' + formatted : formatted
}

function formatDeltaT(ms: number): string {
  const abs = Math.abs(ms)
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : ''
  if (abs < 1000) return sign + abs.toFixed(0) + 'ms'
  return sign + (abs / 1000).toFixed(2) + 's'
}

function clearAnchor(): void {
  anchorT.value = null
}

// --- uPlot lifecycle ------------------------------------------------------
const plotEl = ref<HTMLDivElement | null>(null)
let plot: uPlot | null = null
let resizeObs: ResizeObserver | null = null

function buildOpts(width: number): uPlot.Options {
  return {
    width,
    height: STRIP_HEIGHT,
    pxAlign: 0,
    legend: { show: false },
    cursor: {
      // We handle scrub/anchor ourselves on the overlay — disable uPlot's
      // built-in cursor visuals so the canvas stays clean.
      show: false,
      drag: { x: false, y: false, setScale: false }
    },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    axes: [
      {
        stroke: '#71717a',
        grid: { stroke: '#27272a', width: 0.5 },
        ticks: { stroke: '#27272a', width: 0.5, size: 4 },
        font: '8px monospace',
        // Format absolute seconds as "-Ns" relative to the latest sample.
        values: (_u, vals) => {
          const lat = props.history.length > 0 ? props.history[props.history.length - 1]!.t / 1000 : 0
          return vals.map((v) => {
            const dt = v - lat
            if (Math.abs(dt) < 0.5) return 'now'
            return Math.round(dt) + 's'
          })
        },
        // Force ticks every 5 s across the visible window.
        splits: (_u, _ax, min, max) => {
          const out: number[] = []
          // Round max down to a 5 s boundary, then step back to min.
          const top = Math.floor(max / 5) * 5
          for (let t = top; t >= min; t -= 5) out.push(t)
          return out.reverse()
        }
      },
      { show: false }
    ],
    scales: {
      x: {
        time: false,
        // Always show the trailing 30 s window. dataMax = latest sample's t.
        range: (_u, _dMin, dMax) => [dMax - WINDOW_SECONDS, dMax]
      },
      y: {
        range: [0, 1]
      }
    },
    series: [
      { label: 't' },
      ...props.lines.map(line => ({
        label: line.label,
        stroke: line.color,
        width: 1.5,
        points: { show: false }
      }))
    ],
    hooks: {
      draw: [drawOverlays]
    }
  }
}

// Behaviour bands + scrub playhead + anchor cursor — all drawn directly
// on uPlot's canvas via the `draw` hook so they redraw whenever uPlot does.
function drawOverlays(u: uPlot): void {
  const ctx = u.ctx
  const top = u.bbox.top
  const height = u.bbox.height

  // bands
  for (const band of props.bands) {
    const ts = props.history[band.startIdx]?.t
    const te = props.history[band.endIdx]?.t
    if (ts == null || te == null) continue
    const x1 = u.valToPos(ts / 1000, 'x', true)
    const x2 = u.valToPos(te / 1000, 'x', true)
    if (x2 < x1) continue
    ctx.fillStyle = (band.color ?? '#ef4444') + '26' // ~0.15 alpha
    ctx.fillRect(x1, top, Math.max(1, x2 - x1), height)
  }

  // scrub playhead
  const sIdx = props.scrubIndex
  if (sIdx !== null && sIdx !== undefined) {
    const s = props.history[sIdx]
    if (s) {
      const px = u.valToPos(s.t / 1000, 'x', true)
      ctx.strokeStyle = '#fafafa'
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.75
      ctx.beginPath()
      ctx.moveTo(px, top)
      ctx.lineTo(px, top + height)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  // anchor cursor (alt+click)
  if (anchorT.value !== null && anchorIdx.value !== null) {
    const px = u.valToPos(anchorT.value / 1000, 'x', true)
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.85
    ctx.setLineDash([3, 2])
    ctx.beginPath()
    ctx.moveTo(px, top)
    ctx.lineTo(px, top + height)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
}

onMounted(() => {
  if (!plotEl.value) return
  syncLineMeta()
  seedFromHistory()
  const w = plotEl.value.clientWidth || 1000
  plot = new uPlot(buildOpts(w), viewData(), plotEl.value)

  // Re-size with the container; debouncing isn't worth it for the small
  // panel widths we deal with.
  resizeObs = new ResizeObserver((entries) => {
    if (!plot) return
    const cw = entries[0]?.contentRect.width
    if (cw && cw > 0) plot.setSize({ width: cw, height: STRIP_HEIGHT })
  })
  resizeObs.observe(plotEl.value)
})

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  plot?.destroy()
  plot = null
})

// Latest-sample timestamp is the right reactive signal in both filling and
// steady-state phases of the ring buffer (length is a no-op at full).
watch(() => {
  const h = props.history
  return h.length > 0 ? h[h.length - 1]!.t : -1
}, (newT) => {
  if (!plot) return
  const h = props.history
  // Append fast-path: same history array reference + previous-latest sample
  // sits exactly one slot back from end. /live keeps the same array ref
  // and push+shift always preserves this invariant; /replay swaps the
  // array on lap change, falling through to the full reseed below.
  if (
    props.history === lastHistoryRef
    && h.length >= 2
    && h[h.length - 2]!.t === lastSeenT
    && newT !== lastSeenT
  ) {
    appendToRing(h[h.length - 1]!)
  } else {
    seedFromHistory()
  }
  plot.setData(viewData())
})
// Watch a signature, not the array identity — a parent passing a freshly-
// allocated lines array on every push (motor strip's running-max output)
// would otherwise destroy+rebuild the uPlot instance 60x/s, leaking DOM
// nodes and event listeners between GC sweeps.
function linesSig(lines: LineDef[]): string {
  let s = ''
  for (const l of lines) s += l.key + ':' + l.color + ':' + l.label + '|'
  return s
}
watch(() => linesSig(props.lines), () => {
  // Series colours, count and labels are baked into uPlot options at
  // construction, so a real change in the line set requires a rebuild.
  if (!plot || !plotEl.value) return
  syncLineMeta()
  seedFromHistory()
  const w = plotEl.value.clientWidth || 1000
  plot.destroy()
  plot = new uPlot(buildOpts(w), viewData(), plotEl.value)
})
// Scrub or anchor change → no data change, just an overlay redraw.
watch([() => props.scrubIndex, () => props.bands, anchorT], () => {
  plot?.redraw(false)
}, { deep: true })

// --- Scrub / anchor interaction ------------------------------------------
let dragging = false

function idxFromPointer(e: PointerEvent): number | null {
  if (!plot) return null
  const rect = plot.over.getBoundingClientRect()
  const x = e.clientX - rect.left
  if (x < 0 || x > rect.width) return null
  const tSec = plot.posToVal(x, 'x')
  if (Number.isNaN(tSec)) return null
  return idxForTimestamp(tSec * 1000)
}

function updateScrub(e: PointerEvent): void {
  const idx = idxFromPointer(e)
  if (idx === null) return
  const len = props.bufferLength
  emit('scrub', idx >= len - 5 ? null : idx)
}

function setAnchorFromPointer(e: PointerEvent): void {
  const idx = idxFromPointer(e)
  if (idx === null) return
  const sample = props.history[idx]
  if (!sample) return
  anchorT.value = sample.t
}

function onPointerDown(e: PointerEvent): void {
  if (!props.scrubbable) return
  if (e.altKey) {
    setAnchorFromPointer(e)
    return
  }
  updateScrub(e)
  if (!props.dragScrub) return
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  dragging = true
}

function onPointerMove(e: PointerEvent): void {
  if (!props.scrubbable || !props.dragScrub || !dragging) return
  updateScrub(e)
}

function onPointerEnd(e: PointerEvent): void {
  if (!dragging) return
  dragging = false
  const target = e.currentTarget as HTMLElement
  if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
}
</script>

<template>
  <section class="panel p-4 font-mono text-zinc-100 backdrop-blur">
    <header class="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-400">
      <span class="flex items-center gap-3">
        <span>{{ label }}</span>
        <span
          v-if="scrubbable && anchorIdx === null"
          class="text-zinc-600 normal-case tracking-normal"
        >
          alt+click to anchor
        </span>
      </span>
      <span class="flex items-center gap-3">
        <button
          v-if="anchorIdx !== null && deltaTms !== null"
          type="button"
          class="flex items-center gap-1.5 rounded border border-cyan-700/50 bg-cyan-500/10 px-2 py-0.5 text-cyan-300 hover:bg-cyan-500/20"
          :title="'Clear differential cursor'"
          @click="clearAnchor"
        >
          <span class="tabular-nums">Δt {{ formatDeltaT(deltaTms) }}</span>
          <span class="text-cyan-500/80">×</span>
        </button>
        <span
          v-for="line in lines"
          :key="line.key"
          class="flex items-center gap-1.5"
        >
          <span
            class="inline-block h-1.5 w-3"
            :style="{ background: line.color }"
          />{{ line.label.toLowerCase() }}
        </span>
        <button
          v-if="showPauseButton"
          type="button"
          class="rounded border border-zinc-700 px-2 py-0.5 text-zinc-200 hover:bg-zinc-800"
          :class="paused ? 'bg-amber-500/10 text-amber-300 border-amber-700/50' : ''"
          @click="emit('togglePause')"
        >
          {{ paused ? 'RESUME' : 'PAUSE' }}
        </button>
      </span>
    </header>

    <div class="relative">
      <!-- uPlot mounts inside this element. The overlay listeners drive
           scrub + anchor; uPlot's own cursor is disabled (see opts). -->
      <div
        ref="plotEl"
        class="trace-plot w-full"
        :class="scrubbable ? 'cursor-ew-resize' : ''"
        :style="{ height: STRIP_HEIGHT + 'px' }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
      />

      <!-- Current-value pills (default) or Δ-mode pills (anchor set) -->
      <div
        v-if="latest"
        class="pointer-events-none absolute top-0 right-0 flex h-full flex-col justify-around pr-1 text-[10px] tabular-nums"
      >
        <span
          v-for="line in lines"
          :key="line.key"
          class="rounded px-1.5 py-0.5"
          :style="{ background: line.color + '20', color: line.color }"
        >
          <template v-if="anchorIdx !== null">
            Δ {{ line.label }} {{ deltaForLine(line) }}
          </template>
          <template v-else>
            {{ line.label }} {{ line.fmt(latestValue(line)) }}
          </template>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* uPlot defaults to a light theme; tone it for our dark backdrop. */
.trace-plot :deep(.u-axis) {
  color: #71717a;
}
.trace-plot :deep(.u-legend) {
  display: none;
}
</style>
