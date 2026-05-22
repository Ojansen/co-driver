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
// uPlot wants column-major aligned data: [xs, ys_line0, ys_line1, …].
// We pre-normalize each value into 0..1 using the LineDef's existing
// `norm()` and flip it so 1 = top of strip (uPlot's y axis is bottom-up).
function buildData(): uPlot.AlignedData {
  const h = props.history
  const lines = props.lines
  const xs = new Float64Array(h.length)
  const series: Float64Array[] = lines.map(() => new Float64Array(h.length))
  for (let i = 0; i < h.length; i++) {
    const s = h[i]!
    xs[i] = s.t / 1000 // seconds
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!
      const raw = s[line.key]
      const v = typeof raw === 'number' ? raw : 0
      // line.norm returns 0..1 in SVG-y (0 = top); uPlot is bottom-up,
      // so invert.
      series[li]![i] = 1 - line.norm(v)
    }
  }
  return [xs, ...series] as unknown as uPlot.AlignedData
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

// Map a sample timestamp → buffer index by linear scan. n=1800 max so
// this is fine; binary search would optimize hot paths only.
function idxForTimestamp(tMs: number): number | null {
  const h = props.history
  if (h.length === 0) return null
  let bestIdx = 0
  let bestDiff = Infinity
  for (let i = 0; i < h.length; i++) {
    const d = Math.abs(h[i]!.t - tMs)
    if (d < bestDiff) {
      bestDiff = d
      bestIdx = i
    }
  }
  return bestIdx
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
  const w = plotEl.value.clientWidth || 1000
  plot = new uPlot(buildOpts(w), buildData(), plotEl.value)

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

// --- Update pump ---------------------------------------------------------
// Dirty-flag + 33 ms interval so a steady-state push+shift (which leaves
// length unchanged at full buffer) still updates via the latest-sample
// timestamp signal.
let pathsDirty = true
function flush(): void {
  if (!plot || !pathsDirty) return
  pathsDirty = false
  plot.setData(buildData())
}

watch(() => {
  const h = props.history
  return h.length > 0 ? h[h.length - 1]!.t : -1
}, () => {
  pathsDirty = true
})
watch(() => props.lines, () => {
  // Line set changed — rebuild the plot wholesale because series colours,
  // count and labels are baked into uPlot options at construction time.
  if (!plot || !plotEl.value) return
  const w = plotEl.value.clientWidth || 1000
  plot.destroy()
  plot = new uPlot(buildOpts(w), buildData(), plotEl.value)
})
// Scrub or anchor change → no data change, just an overlay redraw.
watch([() => props.scrubIndex, () => props.bands, anchorT], () => {
  plot?.redraw(false)
}, { deep: true })

useIntervalFn(flush, 33)

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
