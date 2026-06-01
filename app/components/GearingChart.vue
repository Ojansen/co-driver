<script setup lang="ts">
import { buildGearingChart, type GearingModel } from '~/utils/gearing'
import type { DynoCurve } from '~/utils/dyno'

const { prefs, format, unitLabel } = useUnits()

const props = withDefaults(defineProps<{
  /** Dyno torque/power curve — supplies the engine output mapped onto each gear. */
  dyno: DynoCurve
  /** Measured gear ratios + rolling radius. */
  model: GearingModel
  title?: string
  subtitle?: string
  /** Live engine RPM — drives the operating-point marker. */
  currentRpm?: number
  /** Live gear (raw Forza: 1..10 forward) — highlights the active curve. */
  currentGear?: number
  /** Live speed (km/h) — places the operating-point needle. */
  currentSpeedKmh?: number
}>(), {
  title: 'gearing',
  subtitle: '',
  currentRpm: 0,
  currentGear: 0,
  currentSpeedKmh: 0
})

const KMH_TO_MPH = 0.621371
const N_TO_LBF = 0.224809

const VIEW_W = 1000
const VIEW_H = 280
const PAD_T = 24
const PAD_R = 16
const PAD_B = 36
const PAD_L = 48
const PLOT_W = VIEW_W - PAD_L - PAD_R
const PLOT_H = VIEW_H - PAD_T - PAD_B

// Per-gear hues — distinct enough to read 8+ overlapping curves at a glance.
const GEAR_COLORS = [
  '#22d3ee', '#34d399', '#a3e635', '#facc15', '#fb923c',
  '#f87171', '#e879f9', '#a855f7', '#818cf8', '#60a5fa'
]
function gearColor(gear: number): string {
  return GEAR_COLORS[(gear - 1) % GEAR_COLORS.length]!
}

const metric = ref<'force' | 'power'>('force')
// If torque isn't available the force curve can't be drawn — pin to power.
watchEffect(() => {
  if (!chart.value.hasForce) metric.value = 'power'
})

const chart = computed(() => buildGearingChart(props.dyno, props.model))
const isEmpty = computed(() => chart.value.traces.length === 0)

const xMax = computed(() => {
  const hi = chart.value.maxSpeedKmh
  if (hi <= 0) return 100
  // Round up to a tidy 25 km/h step so ticks land cleanly.
  return Math.ceil(hi / 25) * 25
})

const yMax = computed(() => {
  return metric.value === 'force'
    ? Math.max(chart.value.maxForceN, 1)
    : Math.max(chart.value.maxPowerKw, 1)
})

function xFor(speedKmh: number): number {
  const t = speedKmh / xMax.value
  return PAD_L + Math.max(0, Math.min(1, t)) * PLOT_W
}
function yForFraction(fr: number): number {
  return PAD_T + (1 - Math.max(0, Math.min(1, fr))) * PLOT_H
}
function valueOf(p: { forceN: number, powerKw: number }): number {
  return metric.value === 'force' ? p.forceN : p.powerKw
}

const tracePaths = computed(() => {
  return chart.value.traces.map((tr) => {
    let d = ''
    for (let i = 0; i < tr.points.length; i++) {
      const p = tr.points[i]!
      const x = xFor(p.speedKmh)
      const y = yForFraction(valueOf(p) / yMax.value)
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' '
    }
    // Anchor the gear label at the curve's peak value for the active metric.
    let peak = tr.points[0]!
    for (const p of tr.points) if (valueOf(p) > valueOf(peak)) peak = p
    return {
      gear: tr.gear,
      color: gearColor(tr.gear),
      d: d.trim(),
      labelX: xFor(peak.speedKmh),
      labelY: yForFraction(valueOf(peak) / yMax.value)
    }
  })
})

// X-axis ticks in the user's speed unit.
const dispSpeed = (kmh: number) => prefs.value.speed === 'mph' ? kmh * KMH_TO_MPH : kmh
const xTicks = computed(() => {
  const ticks: { x: number, label: string }[] = []
  const step = xMax.value / 5
  for (let i = 0; i <= 5; i++) {
    const kmh = step * i
    ticks.push({ x: xFor(kmh), label: Math.round(dispSpeed(kmh)).toString() })
  }
  return ticks
})

const shiftMarkers = computed(() => {
  return chart.value.shifts
    .filter(s => s.speedKmh > 0 && s.speedKmh <= xMax.value)
    .map(s => ({
      x: xFor(s.speedKmh),
      label: `${s.fromGear}→${s.toGear}`,
      speed: format.speed(s.speedKmh)
    }))
})

const forceUnitLabel = computed(() => prefs.value.downforce === 'lb' ? 'lbf' : 'kN')
function fmtForce(n: number): string {
  if (prefs.value.downforce === 'lb') return `${Math.round(n * N_TO_LBF)} lbf`
  return `${(n / 1000).toFixed(1)} kN`
}
const yAxisLabel = computed(() => metric.value === 'force'
  ? `tractive force (${forceUnitLabel.value})`
  : `wheel power (${unitLabel.power})`)

// Live operating point: needle at current speed + dot on the active gear curve.
const needle = computed(() => {
  if (props.currentSpeedKmh <= 0 || props.currentSpeedKmh > xMax.value) return null
  const x = xFor(props.currentSpeedKmh)
  const tr = chart.value.traces.find(t => t.gear === props.currentGear)
  let dotY: number | null = null
  let value = ''
  if (tr) {
    // Nearest point by speed — traces are dense (one per dyno bucket).
    let best = tr.points[0]!
    for (const p of tr.points) {
      if (Math.abs(p.speedKmh - props.currentSpeedKmh) < Math.abs(best.speedKmh - props.currentSpeedKmh)) best = p
    }
    dotY = yForFraction(valueOf(best) / yMax.value)
    value = metric.value === 'force' ? fmtForce(best.forceN) : format.power(best.powerKw)
  }
  return { x, dotY, value, color: tr ? gearColor(tr.gear) : '#fafafa' }
})

const radiusNote = computed(() => {
  if (props.model.tireRadiusM === null) return 'radius est. pending'
  return `tire r ≈ ${(props.model.tireRadiusM * 100).toFixed(1)} cm`
})
</script>

<template>
  <section class="panel p-4 font-mono text-zinc-100 backdrop-blur">
    <header class="mb-3 flex items-baseline justify-between gap-4 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
      <span>
        {{ title }}
        <span
          v-if="subtitle"
          class="ml-3 normal-case tracking-normal text-zinc-500"
        >{{ subtitle }}</span>
      </span>
      <span class="flex items-center gap-3 normal-case tracking-normal">
        <span class="text-zinc-500">{{ radiusNote }}</span>
        <span class="flex overflow-hidden rounded border border-zinc-700">
          <button
            type="button"
            class="px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] transition-colors"
            :class="metric === 'force' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'"
            :disabled="!chart.hasForce"
            @click="metric = 'force'"
          >force</button>
          <button
            type="button"
            class="px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] transition-colors"
            :class="metric === 'power' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'"
            @click="metric = 'power'"
          >power</button>
        </span>
      </span>
    </header>

    <div
      v-if="isEmpty"
      class="flex h-56 items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-900/30 text-center font-mono text-xs text-zinc-500"
    >
      Pull through every gear at full throttle — each gear's curve appears once
      its ratio is measured.
    </div>

    <svg
      v-else
      :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
      class="w-full"
      preserveAspectRatio="none"
    >
      <!-- Y gridlines -->
      <g
        stroke="#27272a"
        stroke-width="0.5"
      >
        <line
          v-for="frac in [0.25, 0.5, 0.75]"
          :key="frac"
          :x1="PAD_L"
          :x2="VIEW_W - PAD_R"
          :y1="yForFraction(frac)"
          :y2="yForFraction(frac)"
        />
        <line
          :x1="PAD_L"
          :x2="VIEW_W - PAD_R"
          :y1="yForFraction(0)"
          :y2="yForFraction(0)"
          stroke="#3f3f46"
        />
        <line
          :x1="PAD_L"
          :x2="VIEW_W - PAD_R"
          :y1="yForFraction(1)"
          :y2="yForFraction(1)"
          stroke="#3f3f46"
        />
      </g>

      <!-- X-axis ticks + labels -->
      <g
        stroke="#52525b"
        stroke-width="0.5"
      >
        <line
          v-for="t in xTicks"
          :key="t.label"
          :x1="t.x"
          :x2="t.x"
          :y1="VIEW_H - PAD_B"
          :y2="VIEW_H - PAD_B + 4"
        />
      </g>
      <text
        v-for="t in xTicks"
        :key="`l-${t.label}`"
        :x="t.x"
        :y="VIEW_H - PAD_B + 14"
        text-anchor="middle"
        fill="#71717a"
        font-size="9"
        font-family="monospace"
      >{{ t.label }}</text>
      <text
        :x="(PAD_L + VIEW_W - PAD_R) / 2"
        :y="VIEW_H - 4"
        text-anchor="middle"
        fill="#52525b"
        font-size="8"
        font-family="monospace"
      >speed · {{ unitLabel.speed }}</text>
      <text
        :x="PAD_L"
        :y="PAD_T - 10"
        fill="#52525b"
        font-size="8"
        font-family="monospace"
      >{{ yAxisLabel }}</text>

      <!-- Force-crossover markers (where adjacent gears make equal force) -->
      <g
        v-for="s in shiftMarkers"
        :key="`shift-${s.label}`"
      >
        <line
          :x1="s.x"
          :x2="s.x"
          :y1="PAD_T"
          :y2="VIEW_H - PAD_B"
          stroke="#52525b"
          stroke-width="0.6"
          stroke-dasharray="2,3"
        />
        <text
          :x="s.x"
          :y="VIEW_H - PAD_B - 4"
          text-anchor="middle"
          fill="#a1a1aa"
          font-size="8"
          font-family="monospace"
        >{{ s.label }} · {{ s.speed }}</text>
      </g>

      <!-- Per-gear curves -->
      <g
        v-for="tp in tracePaths"
        :key="`g-${tp.gear}`"
      >
        <path
          :d="tp.d"
          fill="none"
          :stroke="tp.color"
          :stroke-width="tp.gear === currentGear ? 2.4 : 1.6"
          stroke-linejoin="round"
          stroke-linecap="round"
          :opacity="currentGear > 0 && tp.gear !== currentGear ? 0.55 : 0.95"
        />
        <text
          :x="tp.labelX"
          :y="tp.labelY - 5"
          text-anchor="middle"
          :fill="tp.color"
          font-size="10"
          font-family="monospace"
          font-weight="bold"
        >{{ tp.gear }}</text>
      </g>

      <!-- Live operating point -->
      <g v-if="needle">
        <line
          :x1="needle.x"
          :x2="needle.x"
          :y1="PAD_T"
          :y2="VIEW_H - PAD_B"
          stroke="#fafafa"
          stroke-width="1"
          opacity="0.5"
        />
        <circle
          v-if="needle.dotY !== null"
          :cx="needle.x"
          :cy="needle.dotY"
          r="3"
          :fill="needle.color"
          stroke="#fafafa"
          stroke-width="1"
        />
        <text
          v-if="needle.dotY !== null && needle.value"
          :x="needle.x"
          :y="needle.dotY - 8"
          text-anchor="middle"
          fill="#fafafa"
          font-size="9"
          font-family="monospace"
        >{{ needle.value }}</text>
      </g>
    </svg>

    <p class="mt-3 text-[11px] leading-relaxed text-zinc-500">
      Each curve is the measured tractive force in one gear across its speed
      range. The dashed line marks where two adjacent gears make
      <span class="text-zinc-300">equal force</span> — their crossover. The gap
      between a gear's redline and the next curve is the force you trade away
      across that ratio step.
    </p>
  </section>
</template>
