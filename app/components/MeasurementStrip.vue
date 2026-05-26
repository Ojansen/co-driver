<script setup lang="ts">
import type { MeasurementSample } from '~/composables/useTelemetry'

/**
 * Lightweight rolling-value strip — renders a single line of server-computed
 * measurements over the same x-axis horizon as TraceStrip, so the freshest
 * reading sits at the right edge directly below the freshest trace sample.
 *
 * No uPlot — a single SVG path is cheap and lets us match the trace strip's
 * plot area pixel-for-pixel via `w-full` + viewBox without any axis padding.
 */

const props = defineProps<{
  /** Recent readings in chronological order. */
  series: MeasurementSample[]
  /** X-axis width in game time, e.g. 30 000 ms to match a 30 s trace strip. */
  windowMs: number
  /** Header text — typically "TB% · 30 s". */
  label: string
  /** Line stroke / pill colour. */
  color: string
  /** Right-edge pill formatter; receives the most recent value. */
  fmt: (v: number) => string
  /** Game-clock ms of the right edge. Pass `history[last].t` so this strip
   *  freezes in sync with the trace strip when the live feed pauses. */
  latestT: number
}>()

const STRIP_HEIGHT = 40
const VIEW_WIDTH = 1000 // logical SVG width; preserveAspectRatio="none" stretches to container

const latest = computed<MeasurementSample | null>(() => {
  const s = props.series
  return s.length > 0 ? (s[s.length - 1] ?? null) : null
})

const latestText = computed<string>(() => {
  const l = latest.value
  if (!l || Number.isNaN(l.value)) return '—'
  return props.fmt(l.value)
})

const pathD = computed<string>(() => {
  const s = props.series
  const windowMs = props.windowMs
  const endT = props.latestT
  if (s.length === 0 || windowMs <= 0 || endT <= 0) return ''
  const startT = endT - windowMs

  let d = ''
  let needMove = true
  for (let i = 0; i < s.length; i++) {
    const sample = s[i]!
    if (sample.endMs < startT || sample.endMs > endT) {
      needMove = true
      continue
    }
    if (Number.isNaN(sample.value)) {
      // Break the path on undefined readings (no braking in window) so
      // the line doesn't pretend to be continuous through a gap.
      needMove = true
      continue
    }
    const x = ((sample.endMs - startT) / windowMs) * VIEW_WIDTH
    const v = Math.max(0, Math.min(1, sample.value))
    const y = (1 - v) * STRIP_HEIGHT
    d += `${needMove ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `
    needMove = false
  }
  return d
})

const windowSeconds = computed<number>(() => Math.round(props.windowMs / 1000))
</script>

<template>
  <section class="panel p-4 font-mono text-zinc-100 backdrop-blur">
    <header class="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-400">
      <span>{{ label }}</span>
      <span class="flex items-center gap-1.5">
        <span
          class="inline-block h-1.5 w-3"
          :style="{ background: color }"
        />
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
        <path
          :d="pathD"
          fill="none"
          :stroke="color"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <div
        class="pointer-events-none absolute top-0 right-0 flex h-full items-center pr-1 text-[10px] tabular-nums"
      >
        <span
          class="rounded px-1.5 py-0.5"
          :style="{ background: color + '20', color: color }"
        >{{ latestText }}</span>
      </div>
    </div>
  </section>
</template>
