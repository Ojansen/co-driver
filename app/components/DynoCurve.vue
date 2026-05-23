<script setup lang="ts">
import { powerbandRange, type DynoCurve as Curve } from '~/utils/dyno'

const { format } = useUnits()

const props = withDefaults(defineProps<{
  curve: Curve
  title?: string
  subtitle?: string
  /** "simple" = chart only. "detailed" = adds powerband shading, shift-point marker, live RPM needle. */
  mode?: 'simple' | 'detailed'
  /** Current engine RPM — only meaningful in detailed mode. */
  currentRpm?: number
}>(), {
  title: 'dyno',
  subtitle: '',
  mode: 'simple',
  currentRpm: 0
})

const VIEW_W = 1000
const VIEW_H = 280
const PAD_T = 24
const PAD_R = 16
const PAD_B = 36
const PAD_L = 48
const PLOT_W = VIEW_W - PAD_L - PAD_R
const PLOT_H = VIEW_H - PAD_T - PAD_B

const COLOR_TORQUE = '#06b6d4'
const COLOR_POWER = '#a855f7'

const isEmpty = computed(() => props.curve.buckets.length === 0)

// X-axis range: from idle (rounded down to 500) to peak rpm (rounded up to 1000).
// Floor the lower bound at 500 — some cars report 0 idle until the engine spools.
const xRange = computed(() => {
  const idle = Math.max(500, Math.floor((props.curve.rpmIdle || 700) / 500) * 500)
  const top = Math.max(idle + 1000, Math.ceil((props.curve.rpmMax || idle + 1000) / 1000) * 1000)
  return { lo: idle, hi: top }
})

function xFor(rpm: number): number {
  const { lo, hi } = xRange.value
  const t = (rpm - lo) / Math.max(hi - lo, 1)
  return PAD_L + Math.max(0, Math.min(1, t)) * PLOT_W
}

// Y axis is normalized 0..1 with each line scaled to its own peak.
function yForFraction(fr: number): number {
  // fr=1 is at the top of the plot
  return PAD_T + (1 - Math.max(0, Math.min(1, fr))) * PLOT_H
}

const torquePeakVal = computed(() => props.curve.peakTorque?.value ?? 1)
const powerPeakVal = computed(() => props.curve.peakPower?.value ?? 1)

const torquePath = computed(() => {
  if (isEmpty.value) return ''
  let out = ''
  for (let i = 0; i < props.curve.buckets.length; i++) {
    const b = props.curve.buckets[i]!
    const x = xFor(b.rpm)
    const y = yForFraction(b.maxTorqueNm / Math.max(torquePeakVal.value, 1))
    out += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' '
  }
  return out.trim()
})

const powerPath = computed(() => {
  if (isEmpty.value) return ''
  let out = ''
  for (let i = 0; i < props.curve.buckets.length; i++) {
    const b = props.curve.buckets[i]!
    const x = xFor(b.rpm)
    const y = yForFraction(b.maxPowerKw / Math.max(powerPeakVal.value, 1))
    out += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' '
  }
  return out.trim()
})

const maxSamples = computed(() => {
  let m = 0
  for (const b of props.curve.buckets) if (b.samples > m) m = b.samples
  return m
})

// X-axis ticks every 1000 RPM
const xTicks = computed(() => {
  const { lo, hi } = xRange.value
  const start = Math.ceil(lo / 1000) * 1000
  const ticks: { x: number, label: string }[] = []
  for (let r = start; r <= hi; r += 1000) {
    ticks.push({ x: xFor(r), label: (r / 1000).toFixed(0) + 'k' })
  }
  return ticks
})

// Powerband only renders in detailed mode
const band = computed(() => {
  if (props.mode !== 'detailed') return null
  return powerbandRange(props.curve, 0.9)
})

const idleX = computed(() => {
  const idle = props.curve.rpmIdle || 700
  return idle >= xRange.value.lo ? xFor(idle) : null
})

const peakTorqueX = computed(() => props.curve.peakTorque ? xFor(props.curve.peakTorque.rpm) : null)
const peakPowerX = computed(() => props.curve.peakPower ? xFor(props.curve.peakPower.rpm) : null)

const needleX = computed(() => {
  if (props.mode !== 'detailed') return null
  if (props.currentRpm <= 0) return null
  if (props.currentRpm < xRange.value.lo || props.currentRpm > xRange.value.hi) return null
  return xFor(props.currentRpm)
})

function fmtRpm(n: number): string {
  return Math.round(n).toString()
}
function fmtNm(n: number): string {
  return format.torque(n)
}
function fmtKw(n: number): string {
  return format.power(n)
}
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
      <span class="flex items-center gap-3">
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block h-1.5 w-3"
            :style="{ background: COLOR_TORQUE }"
          />torque
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block h-1.5 w-3"
            :style="{ background: COLOR_POWER }"
          />power
        </span>
      </span>
    </header>

    <div
      v-if="isEmpty"
      class="flex h-56 items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-900/30 text-center font-mono text-xs text-zinc-500"
    >
      Drive a full-throttle pull to see the curve.
    </div>

    <svg
      v-else
      :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
      class="w-full"
      preserveAspectRatio="none"
    >
      <!-- Y gridlines at 25/50/75/100% of plot height -->
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

      <!-- Detailed mode: powerband shading -->
      <rect
        v-if="band"
        :x="xFor(band.low)"
        :y="PAD_T"
        :width="xFor(band.high) - xFor(band.low)"
        :height="PLOT_H"
        :fill="COLOR_TORQUE"
        opacity="0.07"
      />

      <!-- Idle guideline -->
      <g v-if="idleX !== null">
        <line
          :x1="idleX"
          :x2="idleX"
          :y1="PAD_T"
          :y2="VIEW_H - PAD_B"
          stroke="#52525b"
          stroke-width="0.5"
          stroke-dasharray="2,3"
        />
        <text
          :x="idleX + 4"
          :y="PAD_T + 10"
          fill="#71717a"
          font-size="9"
          font-family="monospace"
        >idle</text>
      </g>

      <!-- X-axis ticks -->
      <g
        stroke="#27272a"
        stroke-width="0.5"
      >
        <line
          v-for="t in xTicks"
          :key="t.label"
          :x1="t.x"
          :x2="t.x"
          :y1="VIEW_H - PAD_B"
          :y2="VIEW_H - PAD_B + 4"
          stroke="#52525b"
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
      >RPM</text>

      <!-- Scatter dots, opacity scaled by sample density -->
      <g v-if="maxSamples > 0">
        <circle
          v-for="b in curve.buckets"
          :key="`t-${b.rpm}`"
          :cx="xFor(b.rpm)"
          :cy="yForFraction(b.maxTorqueNm / torquePeakVal)"
          r="1.6"
          :fill="COLOR_TORQUE"
          :opacity="0.25 + 0.55 * (b.samples / maxSamples)"
        />
        <circle
          v-for="b in curve.buckets"
          :key="`p-${b.rpm}`"
          :cx="xFor(b.rpm)"
          :cy="yForFraction(b.maxPowerKw / powerPeakVal)"
          r="1.6"
          :fill="COLOR_POWER"
          :opacity="0.25 + 0.55 * (b.samples / maxSamples)"
        />
      </g>

      <!-- Curves -->
      <path
        :d="torquePath"
        fill="none"
        :stroke="COLOR_TORQUE"
        stroke-width="1.6"
        stroke-linejoin="round"
        stroke-linecap="round"
        opacity="0.95"
      />
      <path
        :d="powerPath"
        fill="none"
        :stroke="COLOR_POWER"
        stroke-width="1.6"
        stroke-linejoin="round"
        stroke-linecap="round"
        opacity="0.95"
      />

      <!-- Peak markers -->
      <g v-if="peakTorqueX !== null && curve.peakTorque">
        <line
          :x1="peakTorqueX"
          :x2="peakTorqueX"
          :y1="yForFraction(1)"
          :y2="VIEW_H - PAD_B"
          :stroke="COLOR_TORQUE"
          stroke-width="0.6"
          stroke-dasharray="2,3"
          opacity="0.6"
        />
        <circle
          :cx="peakTorqueX"
          :cy="yForFraction(1)"
          r="2.5"
          :fill="COLOR_TORQUE"
        />
        <text
          :x="peakTorqueX"
          :y="yForFraction(1) - 6"
          text-anchor="middle"
          :fill="COLOR_TORQUE"
          font-size="9"
          font-family="monospace"
        >{{ fmtNm(curve.peakTorque.value) }} @ {{ fmtRpm(curve.peakTorque.rpm) }}</text>
      </g>
      <g v-if="peakPowerX !== null && curve.peakPower">
        <line
          :x1="peakPowerX"
          :x2="peakPowerX"
          :y1="yForFraction(1)"
          :y2="VIEW_H - PAD_B"
          :stroke="COLOR_POWER"
          stroke-width="0.6"
          stroke-dasharray="2,3"
          opacity="0.6"
        />
        <circle
          :cx="peakPowerX"
          :cy="yForFraction(1)"
          r="2.5"
          :fill="COLOR_POWER"
        />
        <text
          :x="peakPowerX"
          :y="yForFraction(1) - 6"
          text-anchor="middle"
          :fill="COLOR_POWER"
          font-size="9"
          font-family="monospace"
        >{{ fmtKw(curve.peakPower.value) }} @ {{ fmtRpm(curve.peakPower.rpm) }}</text>
      </g>

      <!-- Detailed mode: shift-up label at peak power -->
      <g v-if="mode === 'detailed' && peakPowerX !== null">
        <text
          :x="peakPowerX"
          :y="PAD_T - 8"
          text-anchor="middle"
          fill="#fafafa"
          font-size="10"
          font-family="monospace"
          font-weight="bold"
        >SHIFT UP</text>
      </g>

      <!-- Detailed mode: live RPM needle -->
      <g v-if="needleX !== null">
        <line
          :x1="needleX"
          :x2="needleX"
          :y1="PAD_T"
          :y2="VIEW_H - PAD_B"
          stroke="#fafafa"
          stroke-width="1.2"
          opacity="0.85"
        />
        <text
          :x="needleX"
          :y="VIEW_H - PAD_B - 6"
          text-anchor="middle"
          fill="#fafafa"
          font-size="9"
          font-family="monospace"
        >{{ fmtRpm(currentRpm) }}</text>
      </g>
    </svg>

    <!-- Readouts (only in detailed mode) -->
    <div
      v-if="mode === 'detailed' && !isEmpty"
      class="mt-3 grid grid-cols-3 gap-2 text-sm tabular-nums"
    >
      <div class="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2">
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Peak torque
        </div>
        <div
          class="mt-0.5"
          :style="{ color: COLOR_TORQUE }"
        >
          {{ curve.peakTorque ? fmtNm(curve.peakTorque.value) : '—' }}
          <span class="text-zinc-500">@</span>
          {{ curve.peakTorque ? fmtRpm(curve.peakTorque.rpm) : '—' }}
        </div>
      </div>
      <div class="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2">
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Peak power
        </div>
        <div
          class="mt-0.5"
          :style="{ color: COLOR_POWER }"
        >
          {{ curve.peakPower ? fmtKw(curve.peakPower.value) : '—' }}
          <span class="text-zinc-500">@</span>
          {{ curve.peakPower ? fmtRpm(curve.peakPower.rpm) : '—' }}
        </div>
      </div>
      <div class="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2">
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Suggested shift
        </div>
        <div class="mt-0.5 text-zinc-100">
          {{ curve.peakPower ? fmtRpm(curve.peakPower.rpm) : '—' }} <span class="text-zinc-500">RPM</span>
        </div>
      </div>
    </div>
  </section>
</template>
