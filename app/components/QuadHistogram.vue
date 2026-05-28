<script setup lang="ts">
import type { BinnedValues } from '~/utils/histogram-core'

const props = withDefaults(defineProps<{
  histograms: {
    fl: BinnedValues
    fr: BinnedValues
    rl: BinnedValues
    rr: BinnedValues
  } | null
  title?: string
  subtitle?: string
  /** Unit suffix on the max-axis label, e.g. "°C". */
  unit?: string
  /** Signed channel — draws a 0 divider and tints the two sides differently. */
  signed?: boolean
  decimals?: number
}>(), {
  title: 'per corner',
  subtitle: '',
  unit: '',
  signed: false,
  decimals: 0
})

const COLOR_BAR = '#e4e4e7' // zinc-200 — unsigned
const COLOR_NEG = '#38bdf8' // sky-400
const COLOR_POS = '#fbbf24' // amber-400
const COLOR_ZERO_LINE = '#3f3f46' // zinc-700

const CELL_W = 280
const CELL_H = 140
const PAD_T = 12
const PAD_R = 14
const PAD_B = 18
const PAD_L = 14
const PLOT_W = CELL_W - PAD_L - PAD_R
const PLOT_H = CELL_H - PAD_T - PAD_B

interface Bar {
  x: number
  y: number
  w: number
  h: number
  color: string
}

function barsFor(h: BinnedValues): Bar[] {
  const out: Bar[] = []
  const total = h.totalSamples || 1
  const edges = h.binEdges
  const minE = edges[0]!
  const maxE = edges[edges.length - 1]!
  const span = maxE - minE || 1
  let maxPct = 0.1
  for (const c of h.counts) {
    const pct = c / total
    if (pct > maxPct) maxPct = pct
  }
  for (let i = 0; i < h.counts.length; i++) {
    const lo = edges[i]!
    const hi = edges[i + 1]!
    const pct = h.counts[i]! / total
    const xL = PAD_L + ((lo - minE) / span) * PLOT_W
    const xR = PAD_L + ((hi - minE) / span) * PLOT_W
    const w = Math.max(1, xR - xL - 1)
    const barH = (pct / maxPct) * PLOT_H
    const mid = (lo + hi) / 2
    const color = props.signed ? (mid < 0 ? COLOR_NEG : COLOR_POS) : COLOR_BAR
    out.push({ x: xL, y: PAD_T + PLOT_H - barH, w, h: barH, color })
  }
  return out
}

function zeroX(h: BinnedValues): number {
  const edges = h.binEdges
  const minE = edges[0]!
  const maxE = edges[edges.length - 1]!
  return PAD_L + ((0 - minE) / (maxE - minE || 1)) * PLOT_W
}

function fmt(v: number): string {
  return v.toFixed(props.decimals)
}

function pctFmt(p: number): string {
  return Math.round(p * 100) + '%'
}

interface Cell {
  key: 'fl' | 'fr' | 'rl' | 'rr'
  label: string
  histogram: BinnedValues | null
}

const cells = computed<Cell[]>(() => {
  const h = props.histograms
  return [
    { key: 'fl', label: 'FL', histogram: h?.fl ?? null },
    { key: 'fr', label: 'FR', histogram: h?.fr ?? null },
    { key: 'rl', label: 'RL', histogram: h?.rl ?? null },
    { key: 'rr', label: 'RR', histogram: h?.rr ?? null }
  ]
})

const hasData = computed(() => props.histograms !== null)
</script>

<template>
  <section class="panel p-4 font-mono text-zinc-100 backdrop-blur">
    <header class="mb-3 flex items-baseline justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
      <span>
        {{ title }}
        <span
          v-if="subtitle"
          class="ml-3 normal-case tracking-normal text-zinc-500"
        >{{ subtitle }}</span>
      </span>
    </header>

    <div
      v-if="!hasData"
      class="flex h-40 items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-900/30 text-xs text-zinc-500"
    >
      Not enough samples in this lap.
    </div>

    <div
      v-else
      class="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <div
        v-for="cell in cells"
        :key="cell.key"
        class="rounded-md border border-zinc-800/80 bg-zinc-950/40 p-2"
      >
        <div class="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em]">
          <span class="text-zinc-400">{{ cell.label }}</span>
          <span
            v-if="cell.histogram"
            class="normal-case tracking-normal text-zinc-500 tabular-nums"
            title="Peak bin time-share"
          >peak {{ pctFmt(cell.histogram.peakPct) }}</span>
        </div>

        <svg
          v-if="cell.histogram"
          :viewBox="`0 0 ${CELL_W} ${CELL_H}`"
          preserveAspectRatio="xMidYMid meet"
          class="block w-full"
        >
          <rect
            v-for="(b, i) in barsFor(cell.histogram)"
            :key="i"
            :x="b.x"
            :y="b.y"
            :width="b.w"
            :height="b.h"
            :fill="b.color"
            opacity="0.85"
          />

          <line
            v-if="signed"
            :x1="zeroX(cell.histogram)"
            :y1="PAD_T"
            :x2="zeroX(cell.histogram)"
            :y2="PAD_T + PLOT_H"
            :stroke="COLOR_ZERO_LINE"
            stroke-width="0.7"
          />

          <text
            :x="PAD_L"
            :y="PAD_T + PLOT_H + 12"
            font-size="8"
            font-family="monospace"
            fill="#52525b"
          >{{ fmt(cell.histogram.binEdges[0]!) }}</text>
          <text
            v-if="signed"
            :x="zeroX(cell.histogram)"
            :y="PAD_T + PLOT_H + 12"
            font-size="8"
            font-family="monospace"
            fill="#52525b"
            text-anchor="middle"
          >0</text>
          <text
            :x="CELL_W - PAD_R"
            :y="PAD_T + PLOT_H + 12"
            font-size="8"
            font-family="monospace"
            fill="#52525b"
            text-anchor="end"
          >{{ fmt(cell.histogram.binEdges[cell.histogram.binEdges.length - 1]!) }}{{ unit ? ' ' + unit : '' }}</text>
        </svg>
      </div>
    </div>
  </section>
</template>
