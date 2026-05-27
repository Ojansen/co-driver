<script setup lang="ts">
import type { MeasurementBand } from '../../server/utils/forza-bus'
import type { MeasurementSample } from '~/composables/useTelemetry'

/**
 * Lightweight rolling-value strip — renders one or more lines of server-
 * computed measurements over the same x-axis horizon as TraceStrip, so the
 * freshest readings sit at the right edge directly below the freshest trace
 * sample.
 *
 * Multi-series shape mirrors TraceStrip's `lines` prop: the caller passes an
 * array of `{ samples, color, pillLabel, fmt }` and the strip renders one
 * path + one right-edge pill per entry. Single-line mounts just pass an
 * array of length 1.
 *
 * No uPlot — a single SVG path per series is cheap and lets us match the
 * trace strip's plot area pixel-for-pixel via `w-full` + viewBox without any
 * axis padding.
 */

export interface MeasurementSeries {
  /** Recent readings in chronological order. Drives the line + the right-edge pill. */
  samples: MeasurementSample[]
  /** Line stroke and pill colour. */
  color: string
  /** Short label shown in the per-series legend (multi-series only), e.g. "TB%" or "CST". */
  pillLabel: string
  /** Formatter applied to the most recent value for the right-edge pill. */
  fmt: (v: number) => string
  /** When present, the series renders as discrete shaded bands (one rect per
   *  predicate-true stretch) instead of a continuous line — e.g. TB% episodes.
   *  The pill still reads the latest `samples` value. */
  bands?: MeasurementBand[]
}

const props = defineProps<{
  series: MeasurementSeries[]
  /** X-axis width in game time, e.g. 30 000 ms to match a 30 s trace strip. */
  windowMs: number
  /** Header text — typically "TB% · 30 s" or "time-in-state · 30 s". */
  label: string
  /** Game-clock ms of the right edge. Pass `history[last].t` so this strip
   *  freezes in sync with the trace strip when the live feed pauses. */
  latestT: number
}>()

const STRIP_HEIGHT = 40
const VIEW_WIDTH = 1000 // logical SVG width; preserveAspectRatio="none" stretches to container

interface SeriesView {
  color: string
  pillLabel: string
  pathD: string
  rects: Array<{ x: number, width: number }>
  latestText: string
}

const seriesViews = computed<SeriesView[]>(() => {
  const windowMs = props.windowMs
  const endT = props.latestT
  const startT = endT - windowMs
  return props.series.map((s) => {
    let pathD = ''
    const rects: Array<{ x: number, width: number }> = []
    if (windowMs > 0 && endT > 0) {
      if (s.bands) {
        // Band mode: one rect per predicate-true stretch, clamped to the plot.
        for (const b of s.bands) {
          if (b.endMs < startT || b.startMs > endT) continue
          const x0 = Math.max(0, ((b.startMs - startT) / windowMs) * VIEW_WIDTH)
          const x1 = Math.min(VIEW_WIDTH, ((b.endMs - startT) / windowMs) * VIEW_WIDTH)
          if (x1 <= x0) continue
          rects.push({ x: x0, width: x1 - x0 })
        }
      } else {
        let needMove = true
        for (let i = 0; i < s.samples.length; i++) {
          const sample = s.samples[i]!
          if (sample.endMs < startT || sample.endMs > endT) {
            needMove = true
            continue
          }
          if (Number.isNaN(sample.value)) {
            // Break the path on undefined readings so the line doesn't
            // pretend to be continuous through a gap.
            needMove = true
            continue
          }
          const x = ((sample.endMs - startT) / windowMs) * VIEW_WIDTH
          const v = Math.max(0, Math.min(1, sample.value))
          const y = (1 - v) * STRIP_HEIGHT
          pathD += `${needMove ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `
          needMove = false
        }
      }
    }
    const latest = s.samples.length > 0 ? (s.samples[s.samples.length - 1] ?? null) : null
    const latestText = !latest || Number.isNaN(latest.value) ? '—' : s.fmt(latest.value)
    return { color: s.color, pillLabel: s.pillLabel, pathD, rects, latestText }
  })
})

const windowSeconds = computed<number>(() => Math.round(props.windowMs / 1000))
</script>

<template>
  <section class="panel p-4 font-mono text-zinc-100 backdrop-blur">
    <header class="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-400">
      <span>{{ label }}</span>
      <span class="flex items-center gap-3">
        <!-- Per-series legend (only when more than one line — otherwise the
             section label + right-edge pill already identify the line). -->
        <template v-if="series.length > 1">
          <span
            v-for="(s, i) in series"
            :key="i"
            class="flex items-center gap-1.5"
          >
            <span
              class="inline-block h-1.5 w-3"
              :style="{ background: s.color }"
            />{{ s.pillLabel.toLowerCase() }}
          </span>
        </template>
        <span class="text-zinc-500 normal-case tracking-normal">last {{ windowSeconds }} s</span>
      </span>
    </header>
    <div class="relative">
      <svg
        :viewBox="`0 0 ${VIEW_WIDTH} ${STRIP_HEIGHT}`"
        preserveAspectRatio="none"
        class="w-full"
        :style="{ height: STRIP_HEIGHT + 'px' }"
      >
        <!-- midpoint reference at 50% -->
        <line
          :x1="0"
          :x2="VIEW_WIDTH"
          :y1="STRIP_HEIGHT * 0.5"
          :y2="STRIP_HEIGHT * 0.5"
          stroke="#27272a"
          stroke-width="0.5"
        />
        <!-- baseline at 0% -->
        <line
          :x1="0"
          :x2="VIEW_WIDTH"
          :y1="STRIP_HEIGHT - 0.5"
          :y2="STRIP_HEIGHT - 0.5"
          stroke="#3f3f46"
          stroke-width="0.5"
        />
        <!-- Band mode: one shaded rect per predicate-true stretch. -->
        <template
          v-for="(v, i) in seriesViews"
          :key="`bands-${i}`"
        >
          <rect
            v-for="(r, j) in v.rects"
            :key="j"
            :x="r.x"
            :y="0"
            :width="r.width"
            :height="STRIP_HEIGHT"
            :fill="v.color"
            fill-opacity="0.35"
          />
        </template>
        <!-- Line mode: continuous sparkline. -->
        <path
          v-for="(v, i) in seriesViews"
          :key="i"
          :d="v.pathD"
          fill="none"
          :stroke="v.color"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <!-- Stacked right-edge value pills, one per series (matches TraceStrip's
           per-line pill column). -->
      <div
        class="pointer-events-none absolute top-0 right-0 flex h-full flex-col justify-around pr-1 text-[10px] tabular-nums"
      >
        <span
          v-for="(v, i) in seriesViews"
          :key="i"
          class="rounded px-1.5 py-0.5"
          :style="{ background: v.color + '20', color: v.color }"
        >{{ v.latestText }}</span>
      </div>
    </div>
  </section>
</template>
