<script setup lang="ts">
import type { DamperScatterPoint } from '~/utils/damper-velocity'

const props = withDefaults(defineProps<{
  scatter: {
    fl: DamperScatterPoint[]
    fr: DamperScatterPoint[]
    rl: DamperScatterPoint[]
    rr: DamperScatterPoint[]
  } | null
  title?: string
  subtitle?: string
}>(), {
  title: 'damper position × velocity',
  subtitle: ''
})

// Position runs 0 (droop) → 1 (bottomed) on X; velocity runs +250 (compression)
// at the top → −250 (rebound) at the bottom on Y. A balanced damper draws a
// roughly symmetric blob; a "C" leaning to one side flags bump/rebound
// imbalance the histogram can't show.
const VEL_CLAMP = 250

const COLOR_DOT = '#fbbf24' // amber-400
const COLOR_AXIS = '#3f3f46' // zinc-700 — 0 mm/s + position axes
const COLOR_BOTTOM_LINE = '#52525b' // zinc-600 — 0.95 bottoming marker

const CELL_W = 280
const CELL_H = 160
const PAD_T = 10
const PAD_R = 12
const PAD_B = 18
const PAD_L = 26
const PLOT_W = CELL_W - PAD_L - PAD_R
const PLOT_H = CELL_H - PAD_T - PAD_B

function xFor(pos: number): number {
  const p = Math.max(0, Math.min(1, pos))
  return PAD_L + p * PLOT_W
}

function yFor(vel: number): number {
  const v = Math.max(-VEL_CLAMP, Math.min(VEL_CLAMP, vel))
  // +VEL at top, −VEL at bottom.
  return PAD_T + ((VEL_CLAMP - v) / (2 * VEL_CLAMP)) * PLOT_H
}

const zeroVelY = PAD_T + PLOT_H / 2
const bottomingX = xFor(0.95)

interface Cell {
  key: 'fl' | 'fr' | 'rl' | 'rr'
  label: string
  points: DamperScatterPoint[] | null
}

const cells = computed<Cell[]>(() => {
  const s = props.scatter
  return [
    { key: 'fl', label: 'FL', points: s?.fl ?? null },
    { key: 'fr', label: 'FR', points: s?.fr ?? null },
    { key: 'rl', label: 'RL', points: s?.rl ?? null },
    { key: 'rr', label: 'RR', points: s?.rr ?? null }
  ]
})

const hasData = computed(() => props.scatter !== null)
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
      <span class="normal-case tracking-normal text-zinc-500">
        x: droop → bottomed · y: rebound ↓ / bump ↑
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
            v-if="cell.points"
            class="normal-case tracking-normal text-zinc-500 tabular-nums"
          >{{ cell.points.length }} pts</span>
        </div>

        <svg
          v-if="cell.points"
          :viewBox="`0 0 ${CELL_W} ${CELL_H}`"
          preserveAspectRatio="xMidYMid meet"
          class="block w-full"
        >
          <!-- 0 mm/s divider -->
          <line
            :x1="PAD_L"
            :y1="zeroVelY"
            :x2="CELL_W - PAD_R"
            :y2="zeroVelY"
            :stroke="COLOR_AXIS"
            stroke-width="0.7"
          />
          <!-- 0.95 bottoming marker -->
          <line
            :x1="bottomingX"
            :y1="PAD_T"
            :x2="bottomingX"
            :y2="PAD_T + PLOT_H"
            :stroke="COLOR_BOTTOM_LINE"
            stroke-width="0.6"
            stroke-dasharray="3,3"
          />

          <!-- Scatter dots -->
          <circle
            v-for="(p, i) in cell.points"
            :key="i"
            :cx="xFor(p.pos)"
            :cy="yFor(p.vel)"
            r="1.1"
            :fill="COLOR_DOT"
            opacity="0.22"
          />

          <!-- Y-axis labels -->
          <text
            :x="PAD_L - 3"
            :y="PAD_T + 6"
            font-size="7"
            font-family="monospace"
            fill="#52525b"
            text-anchor="end"
          >+250</text>
          <text
            :x="PAD_L - 3"
            :y="PAD_T + PLOT_H"
            font-size="7"
            font-family="monospace"
            fill="#52525b"
            text-anchor="end"
          >−250</text>
        </svg>
      </div>
    </div>
  </section>
</template>
