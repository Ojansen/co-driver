<script setup lang="ts">
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

const VIEW_W = 1000
const VIEW_H = 160
const PAD_T = 12
const PAD_B = 18
const TRACE_H = VIEW_H - PAD_T - PAD_B

/**
 * Plot the buffer as an SVG polyline points string. The buffer's logical
 * x-axis is fixed to TRACE_BUFFER_SIZE — short buffers (just-started) draw
 * a line that fills the right side, leaving the left empty.
 *
 * Rebuilt on a throttled schedule (~30 Hz) rather than reactively on every
 * push, because at full buffer × N lines × M strips this dominates /live's
 * CPU at 60 Hz. 30 Hz is visually indistinguishable for thin SVG lines.
 */
const linePaths = shallowRef<string[]>(props.lines.map(() => ''))

function buildLinePaths(): string[] {
  const h = props.history
  const lines = props.lines
  if (h.length < 2) return lines.map(() => '')
  const xStep = VIEW_W / (TRACE_BUFFER_SIZE - 1)
  const offset = TRACE_BUFFER_SIZE - h.length
  return lines.map((line) => {
    const parts: string[] = []
    for (let i = 0; i < h.length; i++) {
      const sample = h[i]!
      const x = (offset + i) * xStep
      const raw = sample[line.key]
      const v = typeof raw === 'number' ? raw : 0
      const y = PAD_T + line.norm(v) * TRACE_H
      parts.push((i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1))
    }
    return parts.join(' ')
  })
}

// Dirty-flag + interval throttle: watchers do nothing but flag the next tick
// (cheap, deterministic), and a 33 ms interval coalesces all pending changes
// into a single rebuild ≈30 Hz. When paused/no new data, dirty stays false
// so the interval is a no-op.
let pathsDirty = true
function rebuildPaths(): void {
  if (!pathsDirty) return
  pathsDirty = false
  linePaths.value = buildLinePaths()
}

watch(() => props.history.length, () => {
  pathsDirty = true
})
watch(() => props.lines, () => {
  pathsDirty = true
  rebuildPaths()
}, { immediate: true })

useIntervalFn(rebuildPaths, 33)

const latest = computed<TraceSample | null>(() => {
  return props.history.length > 0 ? props.history[props.history.length - 1] ?? null : null
})

function latestValue(line: LineDef): number {
  const s = latest.value
  if (!s) return 0
  const raw = s[line.key]
  return typeof raw === 'number' ? raw : 0
}

// 0.5 represents the zero-line for centered signals (steer, yawRate).
const midY = PAD_T + 0.5 * TRACE_H

// --- Scrub interaction -----------------------------------------------------

const playheadX = computed<number | null>(() => {
  if (props.scrubIndex === null || props.scrubIndex === undefined) return null
  const len = props.bufferLength
  if (len <= 1) return null
  const offset = TRACE_BUFFER_SIZE - len
  const xStep = VIEW_W / (TRACE_BUFFER_SIZE - 1)
  return (offset + props.scrubIndex) * xStep
})

// Map a buffer index to a viewBox x — same math as `playheadX` so bands
// align with the path lines pixel-perfectly.
function xForIdx(idx: number): number {
  const len = props.bufferLength || props.history.length
  if (len <= 1) return 0
  const offset = TRACE_BUFFER_SIZE - len
  const xStep = VIEW_W / (TRACE_BUFFER_SIZE - 1)
  return (offset + idx) * xStep
}

interface BandRect {
  x: number
  width: number
  color: string
}

const bandRects = computed<BandRect[]>(() => {
  const out: BandRect[] = []
  for (const b of props.bands) {
    const x1 = xForIdx(b.startIdx)
    const x2 = xForIdx(b.endIdx)
    if (x2 < x1) continue
    out.push({ x: x1, width: Math.max(x2 - x1, 1), color: b.color ?? '#ef4444' })
  }
  return out
})

let dragging = false

/** Map a pointer event to a buffer index, or null if out of range. */
function idxFromPointer(e: PointerEvent): number | null {
  const len = props.bufferLength
  if (len <= 1) return null
  const target = e.currentTarget as SVGSVGElement | null
  if (!target) return null
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0) return null
  const fx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const slot = fx * (TRACE_BUFFER_SIZE - 1)
  const offset = TRACE_BUFFER_SIZE - len
  const idx = Math.round(slot - offset)
  if (idx < 0) return null
  if (idx >= len) return null
  return idx
}

function updateScrub(e: PointerEvent): void {
  const idx = idxFromPointer(e)
  if (idx === null) return
  const len = props.bufferLength
  // Snap to "live"/"current" when within ~5 slots of the right edge.
  emit('scrub', idx >= len - 5 ? null : idx)
}

// --- Differential cursor (anchor) -----------------------------------------
// Alt+click sets/moves an anchor cursor. Anchor is stored as a sample
// timestamp (sample.t) so it sticks to the data, not the buffer index — when
// the rolling buffer scrolls, the anchor scrolls with it and falls off the
// left when the underlying sample drops out of the window.

const anchorT = ref<number | null>(null)

const anchorIdx = computed<number | null>(() => {
  if (anchorT.value === null) return null
  const h = props.history
  if (h.length === 0) return null
  // If the anchor predates the oldest sample, it's scrolled off the buffer.
  if (h[0]!.t > anchorT.value) return null
  let bestIdx = 0
  let bestDiff = Infinity
  for (let i = 0; i < h.length; i++) {
    const diff = Math.abs(h[i]!.t - anchorT.value)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = i
    }
  }
  return bestIdx
})

const anchorX = computed<number | null>(() => {
  const idx = anchorIdx.value
  return idx === null ? null : xForIdx(idx)
})

// Primary index used for delta math — either the parent's scrub position or
// the latest sample when no scrub is active.
const primaryIdx = computed<number | null>(() => {
  if (props.scrubIndex !== null && props.scrubIndex !== undefined) return props.scrubIndex
  if (props.history.length > 0) return props.history.length - 1
  return null
})

function setAnchorFromPointer(e: PointerEvent): void {
  const idx = idxFromPointer(e)
  if (idx === null) return
  const sample = props.history[idx]
  if (!sample) return
  anchorT.value = sample.t
}

function clearAnchor(): void {
  anchorT.value = null
}

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
  // fmt may already prefix '+' for non-negative (steer); don't double it.
  return d > 0 && !formatted.startsWith('+') ? '+' + formatted : formatted
}

function formatDeltaT(ms: number): string {
  const abs = Math.abs(ms)
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : ''
  if (abs < 1000) return sign + abs.toFixed(0) + 'ms'
  return sign + (abs / 1000).toFixed(2) + 's'
}

function onPointerDown(e: PointerEvent): void {
  if (!props.scrubbable) return
  if (e.altKey) {
    setAnchorFromPointer(e)
    return
  }
  updateScrub(e)
  if (!props.dragScrub) return
  const target = e.currentTarget as SVGSVGElement
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
  const target = e.currentTarget as SVGSVGElement
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
      <svg
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        class="w-full"
        :class="scrubbable ? 'cursor-ew-resize' : ''"
        preserveAspectRatio="none"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
      >
        <!-- Behaviour bands (e.g. trail-braking shading) — beneath grid + paths -->
        <rect
          v-for="(band, i) in bandRects"
          :key="`band-${i}`"
          :x="band.x"
          :y="PAD_T"
          :width="band.width"
          :height="TRACE_H"
          :fill="band.color"
          opacity="0.15"
        />

        <!-- Grid: horizontal midline (zero for centered signals) and 25/75 references -->
        <line
          x1="0"
          :y1="midY"
          :x2="VIEW_W"
          :y2="midY"
          stroke="#3f3f46"
          stroke-width="0.5"
          stroke-dasharray="3,3"
        />
        <line
          x1="0"
          :y1="PAD_T + TRACE_H * 0.25"
          :x2="VIEW_W"
          :y2="PAD_T + TRACE_H * 0.25"
          stroke="#27272a"
          stroke-width="0.5"
        />
        <line
          x1="0"
          :y1="PAD_T + TRACE_H * 0.75"
          :x2="VIEW_W"
          :y2="PAD_T + TRACE_H * 0.75"
          stroke="#27272a"
          stroke-width="0.5"
        />

        <!-- Time tick markers: every 2.5s -->
        <g
          v-for="i in 4"
          :key="i"
        >
          <line
            :x1="VIEW_W * (i / 4)"
            :y1="PAD_T"
            :x2="VIEW_W * (i / 4)"
            :y2="VIEW_H - PAD_B"
            stroke="#27272a"
            stroke-width="0.5"
          />
        </g>

        <!-- Trace lines -->
        <path
          v-for="(line, i) in lines"
          :key="line.key"
          :d="linePaths[i]"
          fill="none"
          :stroke="line.color"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity="0.95"
        />

        <!-- Time axis: label every 5 s over the 30 s window -->
        <text
          v-for="i in 7"
          :key="`t${i}`"
          :x="VIEW_W * ((i - 1) / 6)"
          :y="VIEW_H - 4"
          :text-anchor="i === 1 ? 'start' : i === 7 ? 'end' : 'middle'"
          fill="#71717a"
          font-size="8"
          font-family="monospace"
        >
          {{ i === 7 ? 'now' : `-${30 - (i - 1) * 5}s` }}
        </text>

        <!-- Anchor cursor (differential — alt+click) -->
        <line
          v-if="anchorX !== null"
          :x1="anchorX"
          :x2="anchorX"
          :y1="PAD_T"
          :y2="VIEW_H - PAD_B"
          stroke="#22d3ee"
          stroke-width="1"
          stroke-dasharray="3,2"
          opacity="0.85"
        />

        <!-- Scrub playhead -->
        <line
          v-if="playheadX !== null"
          :x1="playheadX"
          :x2="playheadX"
          :y1="PAD_T"
          :y2="VIEW_H - PAD_B"
          stroke="#fafafa"
          stroke-width="1"
          opacity="0.75"
        />
      </svg>

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
