<script setup lang="ts">
import { polar, arcPath, clampUnit } from '~/utils/gauge'

// Generic 270° round gauge with a needle. The parent supplies the normalized
// needle position, the tick set, and the digital readout — so the same dial
// renders rpm, speed, and boost.
const props = withDefaults(defineProps<{
  /** Needle position, 0..1 across the sweep. */
  frac: number
  ticks: { frac: number, label: string, accent?: boolean }[]
  accent: string
  value: string
  label: string
  unit?: string
  /** Start of the red zone (0..1); omit for no redline band. */
  redlineFrac?: number
}>(), {
  unit: '',
  redlineFrac: undefined
})

const START = -135
const SWEEP = 270
const R = 78

const trackPath = arcPath(100, 100, R, START, START + SWEEP)
const redlinePath = computed(() =>
  props.redlineFrac === undefined
    ? ''
    : arcPath(100, 100, R, START + props.redlineFrac * SWEEP, START + SWEEP))

const needleTip = computed(() => polar(100, 100, R - 14, START + clampUnit(props.frac) * SWEEP))

const tickGeo = computed(() => props.ticks.map((t) => {
  const ang = START + clampUnit(t.frac) * SWEEP
  const a = polar(100, 100, R, ang)
  const b = polar(100, 100, R - 7, ang)
  const l = polar(100, 100, R - 17, ang)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, lx: l.x, ly: l.y, label: t.label, accent: t.accent }
}))
</script>

<template>
  <svg
    viewBox="0 0 200 200"
    class="aspect-square w-full"
  >
    <circle
      cx="100"
      cy="100"
      r="96"
      fill="#0f0f12"
      stroke="#27272a"
      stroke-width="1"
    />
    <path
      :d="trackPath"
      fill="none"
      stroke="#3f3f46"
      stroke-width="3"
      stroke-linecap="round"
    />
    <path
      v-if="redlinePath"
      :d="redlinePath"
      fill="none"
      stroke="#ef4444"
      stroke-width="3"
      stroke-linecap="round"
      opacity="0.85"
    />
    <g>
      <line
        v-for="(tk, i) in tickGeo"
        :key="i"
        :x1="tk.x1"
        :y1="tk.y1"
        :x2="tk.x2"
        :y2="tk.y2"
        :stroke="tk.accent ? '#ef4444' : '#71717a'"
        stroke-width="1"
      />
      <text
        v-for="(tk, i) in tickGeo"
        v-show="tk.label"
        :key="'l' + i"
        :x="tk.lx"
        :y="tk.ly"
        text-anchor="middle"
        dominant-baseline="central"
        :fill="tk.accent ? '#f87171' : '#a1a1aa'"
        font-size="9"
        font-family="monospace"
      >{{ tk.label }}</text>
    </g>
    <!-- needle -->
    <line
      x1="100"
      y1="100"
      :x2="needleTip.x"
      :y2="needleTip.y"
      :stroke="accent"
      stroke-width="2.4"
      stroke-linecap="round"
    />
    <circle
      cx="100"
      cy="100"
      r="6"
      fill="#18181b"
      :stroke="accent"
      stroke-width="1.6"
    />
    <!-- digital readout -->
    <text
      x="100"
      y="124"
      text-anchor="middle"
      fill="#fafafa"
      font-size="26"
      font-family="monospace"
    >{{ value }}</text>
    <text
      v-if="unit"
      x="100"
      y="140"
      text-anchor="middle"
      fill="#71717a"
      font-size="10"
      font-family="monospace"
    >{{ unit }}</text>
    <!-- label in the bottom gap -->
    <text
      x="100"
      y="178"
      text-anchor="middle"
      fill="#71717a"
      font-size="9"
      font-family="monospace"
      letter-spacing="1.5"
    >{{ label }}</text>
  </svg>
</template>
