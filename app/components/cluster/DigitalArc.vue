<script setup lang="ts">
import { gearLabel } from '~/utils/tuning'
import { polar, arcPath, clampUnit } from '~/utils/gauge'

// Digital cluster: a wide shallow rev arc across the top with large gear +
// speed digits beneath, plus a bidirectional digital boost bar.
const props = defineProps<{
  rpm: number
  rpmMax: number
  gear: number
  speedKmh: number
  /** Engine boost, gauge PSI relative to ambient (Forza native). */
  boost: number
  /** Whether to show the boost bar (hidden on NA cars). */
  hasBoost: boolean
}>()

const { prefs, unitLabel, toDisplay } = useUnits()

const CX = 110
const CY = 108
const AR = 90
const ASTART = -70
const ASWEEP = 140

function rpmZone(rpm: number, max: number): string {
  const r = rpm / Math.max(max, 1)
  if (r > 0.95) return '#ef4444'
  if (r > 0.85) return '#f59e0b'
  return '#22c55e'
}

const rpmFrac = computed(() => props.rpmMax > 0 ? clampUnit(props.rpm / props.rpmMax) : 0)
const rpmAccent = computed(() => rpmZone(props.rpm, props.rpmMax))

const arcTrack = arcPath(CX, CY, AR, ASTART, ASTART + ASWEEP)
const arcRedline = arcPath(CX, CY, AR, ASTART + 0.85 * ASWEEP, ASTART + ASWEEP)
const arcValue = computed(() => rpmFrac.value <= 0.002 ? '' : arcPath(CX, CY, AR, ASTART, ASTART + rpmFrac.value * ASWEEP))
const marker = computed(() => polar(CX, CY, AR, ASTART + rpmFrac.value * ASWEEP))

const arcTicks = computed(() => {
  const max = props.rpmMax > 0 ? props.rpmMax : 8000
  const out: { x1: number, y1: number, x2: number, y2: number, lx: number, ly: number, label: number, red: boolean }[] = []
  const maxK = Math.floor(max / 1000)
  for (let i = 0; i <= maxK; i++) {
    const f = (i * 1000) / max
    const ang = ASTART + f * ASWEEP
    const a = polar(CX, CY, AR, ang)
    const b = polar(CX, CY, AR - 7, ang)
    const l = polar(CX, CY, AR + 9, ang)
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, lx: l.x, ly: l.y, label: i, red: f >= 0.85 })
  }
  return out
})

const speedDisplay = computed(() =>
  prefs.value.speed === 'mph' ? Math.round(props.speedKmh * 0.621371) : Math.round(props.speedKmh))

// --- boost bar (range -15..+30 psi, zero at one third) ---
const ZERO_PCT = 100 / 3
const boostValue = computed(() => String(toDisplay.boost(props.boost)))
const boostValPct = computed(() => clampUnit((props.boost + 15) / 45) * 100)
const boostBarStyle = computed(() => props.boost >= 0
  ? { left: ZERO_PCT + '%', width: (boostValPct.value - ZERO_PCT) + '%' }
  : { left: boostValPct.value + '%', width: (ZERO_PCT - boostValPct.value) + '%' })
</script>

<template>
  <div class="flex h-full flex-col justify-center gap-2">
    <svg
      viewBox="0 0 220 100"
      class="w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        :d="arcTrack"
        fill="none"
        stroke="#27272a"
        stroke-width="5"
        stroke-linecap="round"
      />
      <path
        :d="arcRedline"
        fill="none"
        stroke="#7f1d1d"
        stroke-width="5"
        stroke-linecap="round"
        opacity="0.6"
      />
      <path
        v-if="arcValue"
        :d="arcValue"
        fill="none"
        :stroke="rpmAccent"
        stroke-width="5"
        stroke-linecap="round"
      />
      <g>
        <line
          v-for="(tk, i) in arcTicks"
          :key="i"
          :x1="tk.x1"
          :y1="tk.y1"
          :x2="tk.x2"
          :y2="tk.y2"
          :stroke="tk.red ? '#ef4444' : '#71717a'"
          stroke-width="1"
        />
        <text
          v-for="(tk, i) in arcTicks"
          :key="'l' + i"
          :x="tk.lx"
          :y="tk.ly"
          text-anchor="middle"
          dominant-baseline="central"
          :fill="tk.red ? '#f87171' : '#a1a1aa'"
          font-size="8"
          font-family="monospace"
        >{{ tk.label }}</text>
      </g>
      <circle
        :cx="marker.x"
        :cy="marker.y"
        r="3.5"
        :fill="rpmAccent"
        stroke="#0f0f12"
        stroke-width="0.8"
      />
    </svg>

    <div class="text-center text-[11px] tabular-nums text-zinc-500">
      {{ Math.round(rpm) }} <span class="text-zinc-600">/ {{ Math.round(rpmMax) }} rpm</span>
    </div>

    <div class="flex items-end justify-between gap-3 px-1">
      <NuxtLink
        to="/tune/gearing"
        class="group flex flex-col"
      >
        <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500 transition-colors group-hover:text-green-300">GEAR</span>
        <span class="text-6xl leading-none font-light tabular-nums text-zinc-100 sm:text-7xl">{{ gearLabel(gear) }}</span>
      </NuxtLink>
      <div class="flex flex-col items-end">
        <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{{ unitLabel.speed }}</span>
        <span class="text-5xl leading-none font-light tabular-nums text-zinc-100 sm:text-6xl">{{ speedDisplay }}</span>
      </div>
    </div>

    <div
      v-if="hasBoost"
      class="px-1"
    >
      <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        <span>BOOST</span>
        <span class="tabular-nums text-zinc-300">{{ boostValue }} {{ unitLabel.boost }}</span>
      </div>
      <div class="relative mt-1 h-2.5 w-full overflow-hidden rounded bg-zinc-800">
        <div
          class="absolute top-0 h-full w-px bg-zinc-600"
          :style="{ left: ZERO_PCT + '%' }"
        />
        <div
          class="absolute top-0 h-full"
          :class="boost >= 0 ? 'bg-green-500' : 'bg-sky-400'"
          :style="boostBarStyle"
        />
      </div>
    </div>
  </div>
</template>
