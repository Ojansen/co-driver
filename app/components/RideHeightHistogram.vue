<script setup lang="ts">
import type { RideHeightHistogram } from '~/utils/ride-height'

const props = withDefaults(defineProps<{
  histograms: {
    fl: RideHeightHistogram
    fr: RideHeightHistogram
    rl: RideHeightHistogram
    rr: RideHeightHistogram
  } | null
  title?: string
  subtitle?: string
}>(), {
  title: 'ride height',
  subtitle: ''
})

// Travel reads left→right as droop→bottomed. Bars deepen in color toward the
// compressed end so a chassis that rides low stands out without copy.
const COLOR_DROOP = '#e4e4e7' // zinc-200 — extended, lightly loaded
const COLOR_MID = '#a3a3a3' // neutral-400 — normal working range
const COLOR_COMPRESSED = '#fbbf24' // amber-400 — heavily loaded
const COLOR_BOTTOMING = '#f97316' // orange-500 — out of travel
const COLOR_BOTTOM_LINE = '#52525b' // zinc-600 — 0.95 bottoming marker

const BOTTOMING_MIN = 0.95
const MID_MAX = 0.75
const DROOP_MAX = 0.25

function colorForBin(leftEdge: number, rightEdge: number): string {
  const mid = (leftEdge + rightEdge) / 2
  if (mid > BOTTOMING_MIN) return COLOR_BOTTOMING
  if (mid > MID_MAX) return COLOR_COMPRESSED
  if (mid > DROOP_MAX) return COLOR_MID
  return COLOR_DROOP
}

// Each cell: 280 × 140 viewBox, matching SuspensionHistogram so the two views
// sit together cleanly.
const CELL_W = 280
const CELL_H = 140
const PAD_T = 12
const PAD_R = 14
const PAD_B = 20
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

function barsFor(h: RideHeightHistogram): Bar[] {
  const out: Bar[] = []
  const total = h.totalSamples || 1
  const edges = h.binEdges
  const minE = edges[0]!
  const maxE = edges[edges.length - 1]!
  const span = maxE - minE || 1
  // Auto-scale Y to the tallest bar so a tightly-held platform (one dominant
  // band) and a busy one both read.
  let maxPct = 0.12
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
    out.push({
      x: xL,
      y: PAD_T + PLOT_H - barH,
      w,
      h: barH,
      color: colorForBin(lo, hi)
    })
  }
  return out
}

function bottomingLineX(h: RideHeightHistogram): number {
  const edges = h.binEdges
  const minE = edges[0]!
  const maxE = edges[edges.length - 1]!
  return PAD_L + ((BOTTOMING_MIN - minE) / (maxE - minE || 1)) * PLOT_W
}

function pctFmt(p: number): string {
  return Math.round(p * 100) + '%'
}

interface Cell {
  key: 'fl' | 'fr' | 'rl' | 'rr'
  label: string
  histogram: RideHeightHistogram | null
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
      <span class="flex items-center gap-3 normal-case tracking-normal text-zinc-500">
        <span class="flex items-center gap-1">
          <span
            class="inline-block h-2 w-2.5"
            :style="{ background: COLOR_DROOP }"
          />droop
        </span>
        <span class="flex items-center gap-1">
          <span
            class="inline-block h-2 w-2.5"
            :style="{ background: COLOR_COMPRESSED }"
          />low
        </span>
        <span class="flex items-center gap-1">
          <span
            class="inline-block h-2 w-2.5"
            :style="{ background: COLOR_BOTTOMING }"
          />bottoming
        </span>
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
            :title="'Peak band time-share'"
          >peak {{ pctFmt(cell.histogram.peakPct) }}</span>
        </div>

        <svg
          v-if="cell.histogram"
          :viewBox="`0 0 ${CELL_W} ${CELL_H}`"
          preserveAspectRatio="xMidYMid meet"
          class="block w-full"
        >
          <!-- Histogram bars -->
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

          <!-- 0.95 bottoming marker -->
          <line
            :x1="bottomingLineX(cell.histogram)"
            :y1="PAD_T"
            :x2="bottomingLineX(cell.histogram)"
            :y2="PAD_T + PLOT_H"
            :stroke="COLOR_BOTTOM_LINE"
            stroke-width="0.7"
            stroke-dasharray="3,3"
          />

          <!-- x-axis labels: droop / bottomed -->
          <text
            :x="PAD_L"
            :y="PAD_T + PLOT_H + 12"
            font-size="8"
            font-family="monospace"
            fill="#52525b"
          >droop</text>
          <text
            :x="CELL_W - PAD_R"
            :y="PAD_T + PLOT_H + 12"
            font-size="8"
            font-family="monospace"
            fill="#52525b"
            text-anchor="end"
          >bottomed</text>
        </svg>

        <!-- Band time-share readout -->
        <div
          v-if="cell.histogram"
          class="mt-1 grid grid-cols-4 gap-1 text-center text-[9px] uppercase tracking-[0.1em] text-zinc-500"
        >
          <div>
            <div>droop</div>
            <div class="text-zinc-300 tabular-nums">
              {{ pctFmt(cell.histogram.droopPct) }}
            </div>
          </div>
          <div>
            <div>mid</div>
            <div class="text-zinc-300 tabular-nums">
              {{ pctFmt(cell.histogram.midPct) }}
            </div>
          </div>
          <div>
            <div>comp</div>
            <div class="text-zinc-300 tabular-nums">
              {{ pctFmt(cell.histogram.compressedPct) }}
            </div>
          </div>
          <div>
            <div>bottom</div>
            <div class="text-zinc-300 tabular-nums">
              {{ pctFmt(cell.histogram.bottomingPct) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
