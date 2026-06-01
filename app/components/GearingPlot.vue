<script setup lang="ts">
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { GearingGrid } from '~/utils/gearing'

const { prefs, format, unitLabel } = useUnits()

const props = withDefaults(defineProps<{
  /** Per-gear measured accel-g / power on a shared speed grid. */
  grid: GearingGrid
  title?: string
  subtitle?: string
}>(), {
  title: 'gearing',
  subtitle: ''
})

const KMH_TO_MPH = 0.621371
const KW_TO_HP = 1.34102
const KW_TO_PS = 1.35962

// Per-gear hues — distinct enough to read 8+ overlapping curves at a glance.
const GEAR_COLORS = [
  '#22d3ee', '#34d399', '#a3e635', '#facc15', '#fb923c',
  '#f87171', '#e879f9', '#a855f7', '#818cf8', '#60a5fa'
]
function gearColor(gear: number): string {
  return GEAR_COLORS[(gear - 1) % GEAR_COLORS.length]!
}

const uid = Math.random().toString(36).slice(2, 9)
const syncKey = `gearing-${uid}`

const dispSpeed = (kmh: number) => prefs.value.speed === 'mph' ? kmh * KMH_TO_MPH : kmh
const dispPowerNum = (kw: number) => {
  if (prefs.value.power === 'hp') return kw * KW_TO_HP
  if (prefs.value.power === 'ps') return kw * KW_TO_PS
  return kw
}

// --- Y-axis lens ----------------------------------------------------------
type Metric = 'accel' | 'power'
const metric = ref<Metric>('accel')
// Fall back to whichever lens actually has data, but respect a manual pick.
watch(() => [props.grid.hasAccel, props.grid.hasPower] as const, ([hasAccel, hasPower]) => {
  if (metric.value === 'accel' && !hasAccel && hasPower) metric.value = 'power'
  else if (metric.value === 'power' && !hasPower && hasAccel) metric.value = 'accel'
})

interface MetricDef {
  label: string
  unit: string
  max: () => number
  fmt: (v: number) => string
  axis: (v: number) => string
  series: (s: GearingGrid['series'][number]) => (number | null)[]
}
const METRICS: Record<Metric, MetricDef> = {
  accel: {
    label: 'ACCELERATION',
    unit: 'g',
    max: () => Math.max(props.grid.maxAccelG * 1.1, 0.1),
    fmt: v => `${v.toFixed(2)} g`,
    axis: v => v.toFixed(2),
    series: s => s.accelG
  },
  power: {
    label: 'WHEEL POWER',
    unit: unitLabel.power,
    max: () => Math.max(props.grid.maxPowerKw * 1.05, 1),
    fmt: v => format.power(v),
    axis: v => Math.round(dispPowerNum(v)).toString(),
    series: s => s.power
  }
}
const active = computed(() => METRICS[metric.value])

const isEmpty = computed(() => props.grid.series.length === 0 || props.grid.speedsKmh.length === 0)

// --- uPlot lifecycle ------------------------------------------------------
const plotEl = ref<HTMLDivElement | null>(null)
let plot: uPlot | null = null
let resizeObs: ResizeObserver | null = null
const cursorIdx = ref<number | null>(null)
const PLOT_H = 300

function buildData(): uPlot.AlignedData {
  const series = props.grid.series.map(s => active.value.series(s))
  return [props.grid.speedsKmh, ...series] as unknown as uPlot.AlignedData
}

function buildOpts(width: number): uPlot.Options {
  const series: uPlot.Series[] = [
    { label: 'speed' },
    ...props.grid.series.map(s => ({
      label: String(s.gear),
      stroke: gearColor(s.gear),
      width: 1.8,
      points: { show: false }
    }))
  ]
  return {
    width,
    height: PLOT_H,
    pxAlign: 0,
    legend: { show: false },
    cursor: {
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
        size: 26,
        values: (_u, vals) => vals.map(v => Math.round(dispSpeed(v)).toString())
      },
      {
        stroke: '#71717a',
        grid: { stroke: '#27272a', width: 0.5 },
        ticks: { stroke: '#27272a', width: 0.5, size: 4 },
        font: '9px monospace',
        size: 42,
        values: (_u, vals) => vals.map(v => active.value.axis(v))
      }
    ],
    scales: {
      x: { time: false },
      y: { range: () => [0, active.value.max()] }
    },
    series,
    hooks: {
      setCursor: [
        (u: uPlot) => {
          const idx = u.cursor.idx
          cursorIdx.value = (idx === undefined || idx === null) ? null : idx
        }
      ]
    }
  }
}

function renderPlot(): void {
  destroyPlot()
  if (isEmpty.value || !plotEl.value) return
  const w = plotEl.value.clientWidth || 1000
  plot = new uPlot(buildOpts(w), buildData(), plotEl.value)
}

function destroyPlot(): void {
  plot?.destroy()
  plot = null
}

// Structure fingerprint — rebuild on gear/grid-shape change; otherwise a cheap
// setData keeps the live curve flowing without tearing down the canvas.
function structureKey(): string {
  return `${props.grid.speedsKmh.length}|${props.grid.series.map(s => s.gear).join(',')}`
}
let lastStructure = ''

function syncPlot(): void {
  const key = structureKey()
  if (!plot || key !== lastStructure) {
    lastStructure = key
    nextTick(() => renderPlot())
    return
  }
  plot.setData(buildData())
}

function resetZoom(): void {
  if (isEmpty.value || !plot) return
  const xs = props.grid.speedsKmh
  plot.setScale('x', { min: xs[0] ?? 0, max: xs[xs.length - 1] ?? 0 })
}

onMounted(() => {
  lastStructure = structureKey()
  renderPlot()
  resizeObs = new ResizeObserver(() => {
    if (plot && plotEl.value && plotEl.value.clientWidth > 0) {
      plot.setSize({ width: plotEl.value.clientWidth, height: PLOT_H })
    }
  })
  if (plotEl.value) resizeObs.observe(plotEl.value)
})

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  destroyPlot()
})

// Push new data to the plot at most ~3x/s while driving (rAF-budget friendly).
watchThrottled(() => props.grid, () => syncPlot(), { throttle: 300 })
// Switching lens or units is instant — rebuild so axes + ranges follow.
watch([metric, () => prefs.value.speed, () => prefs.value.power], () => {
  if (plot) plot.setData(buildData())
  plot?.redraw()
})

// --- hover legend ---------------------------------------------------------
interface HoverGear {
  gear: number
  color: string
  value: number | null
}
const hover = computed<{ speedKmh: number, gears: HoverGear[] } | null>(() => {
  const i = cursorIdx.value
  const g = props.grid
  if (i === null || i < 0 || i >= g.speedsKmh.length) return null
  return {
    speedKmh: g.speedsKmh[i]!,
    gears: g.series.map(s => ({
      gear: s.gear,
      color: gearColor(s.gear),
      value: active.value.series(s)[i] ?? null
    }))
  }
})
</script>

<template>
  <section class="panel p-4 font-mono text-zinc-100 backdrop-blur">
    <header class="mb-3 flex flex-wrap items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
      <span class="flex items-center gap-3">
        <span>
          {{ title }}
          <span
            v-if="subtitle"
            class="ml-2 normal-case tracking-normal text-zinc-500"
          >{{ subtitle }}</span>
        </span>
        <span
          v-if="hover"
          class="rounded bg-zinc-800/80 px-1.5 py-0.5 normal-case tracking-normal text-zinc-200 tabular-nums"
        >@ {{ format.speed(hover.speedKmh) }}</span>
        <button
          v-if="!isEmpty"
          type="button"
          class="rounded border border-zinc-700 px-1.5 py-0.5 normal-case tracking-normal text-zinc-300 hover:bg-zinc-800"
          title="Reset zoom (or double-click the plot)"
          @click="resetZoom"
        >reset zoom</button>
        <!-- Y-axis lens toggle -->
        <span class="flex overflow-hidden rounded border border-zinc-700">
          <button
            type="button"
            class="px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] transition-colors"
            :class="metric === 'accel' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'"
            :disabled="!grid.hasAccel"
            @click="metric = 'accel'"
          >accel g</button>
          <button
            type="button"
            class="px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] transition-colors"
            :class="metric === 'power' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'"
            :disabled="!grid.hasPower"
            @click="metric = 'power'"
          >power</button>
        </span>
      </span>
      <!-- Gear color legend -->
      <span class="flex flex-wrap items-center gap-x-3 gap-y-1 normal-case tracking-normal">
        <span
          v-for="s in grid.series"
          :key="s.gear"
          class="flex items-center gap-1"
        >
          <span
            class="inline-block h-1.5 w-3"
            :style="{ background: gearColor(s.gear) }"
          />
          <span class="text-zinc-400">gear {{ s.gear }}</span>
        </span>
      </span>
    </header>

    <div
      v-if="isEmpty"
      class="flex h-64 items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-900/30 text-center font-mono text-xs text-zinc-500"
    >
      Pull through every gear at full throttle on a flat road — each gear's curve
      fills in as you measure its acceleration across the speed range.
    </div>

    <div
      v-else
      class="relative"
    >
      <span class="pointer-events-none absolute left-1 top-1 z-10 text-[9px] uppercase tracking-[0.2em] text-zinc-500">
        {{ active.label }} · {{ active.unit }}  vs  speed · {{ unitLabel.speed }}
      </span>
      <span
        v-if="hover"
        class="pointer-events-none absolute right-1 top-1 z-10 flex flex-wrap justify-end gap-1 text-[10px] tabular-nums"
      >
        <template
          v-for="hg in hover.gears"
          :key="hg.gear"
        >
          <span
            v-if="hg.value !== null"
            class="rounded px-1.5 py-0.5"
            :style="{ background: hg.color + '20', color: hg.color }"
          >{{ active.fmt(hg.value) }}</span>
        </template>
      </span>
      <div
        ref="plotEl"
        class="gearing-plot w-full"
        :style="{ height: PLOT_H + 'px' }"
      />
    </div>

    <p class="mt-3 text-[11px] leading-relaxed text-zinc-500">
      Measured per gear at full throttle. The top edge across all gears is what
      you actually get at each speed; where a gear's curve drops below the next,
      the gears trade places. Acceleration flat-tops where the tyres run out of
      grip — that ceiling is the traction limit, no estimate needed.
    </p>
  </section>
</template>

<style scoped>
.gearing-plot :deep(.u-legend) {
  display: none;
}
.gearing-plot :deep(.u-select) {
  background: rgba(34, 211, 238, 0.12);
  border: 1px solid rgba(34, 211, 238, 0.4);
}
.gearing-plot :deep(.u-cursor-x),
.gearing-plot :deep(.u-cursor-y) {
  border-color: rgba(250, 250, 250, 0.5);
}
</style>
