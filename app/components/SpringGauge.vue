<script setup lang="ts">
import { suspColor } from '~/utils/tuning'
import { clampUnit } from '~/utils/gauge'

const { format } = useUnits()

const props = withDefaults(defineProps<{
  /** normalized suspension travel, 0 = fully extended (droop), 1 = fully compressed (bottomed) */
  compression: number
  /** signed damper velocity mm/s — +ve = compression, -ve = rebound */
  damperVelocityMmS?: number
  /** absolute travel in meters, for the readout */
  suspensionMeters: number
  /** compression past the bottoming threshold — drives the red pulse */
  bottoming: boolean
}>(), {
  damperVelocityMmS: 0
})

// --- coil-spring geometry --------------------------------------------------
// A fixed number of coils whose total span shrinks as the wheel compresses, so
// the pitch (vertical gap per coil) decreases and the coils visually bunch —
// the 2D analogue of CarAttitude3D's springRingYs() ring-spacing shrink.
const CX = 20 // helix horizontal center within the 0..40 viewBox
const AMP = 12 // helix half-width (coil radius in x)
const COILS = 6
const SAMPLES = 12 // points per coil; 6*12 = 72 → smooth at panel size
const CAP_TOP = 8 // chassis-side cap at full extension
const CAP_BOT = 92 // hub/road-side mounting cap (fixed — the wheel sits on the road)
const MIN_SPAN = 34 // shortest coil span (fully compressed / bunched)
const MAX_SPAN = CAP_BOT - CAP_TOP // 84 — fully extended

// Ground reference frame: the bottom cap (wheel/road) is anchored and the top
// cap (chassis) descends as the corner compresses, so the body visibly squats
// onto the wheel and the coils bunch toward the base.
const span = computed(() => MAX_SPAN - clampUnit(props.compression) * (MAX_SPAN - MIN_SPAN))
const yTop = computed(() => CAP_BOT - span.value)

const stroke = computed(() => suspColor(props.compression))

const coilPath = computed(() => {
  const n = COILS * SAMPLES
  const top = yTop.value
  const bottom = CAP_BOT
  let d = ''
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const y = top + t * (bottom - top)
    const x = CX + AMP * Math.sin(t * COILS * 2 * Math.PI)
    d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' '
  }
  return d.trim()
})

// --- damper-velocity bar ---------------------------------------------------
// Zero at the vertical middle. Per the friction-circle convention used in
// CornerPanel.project() (positive plots DOWN), compression (+ve) fills
// downward from center and rebound (-ve) fills upward.
const DAMP_MID = 50
const DAMP_MAX_MMS = 80 // |v| that fills the bar to its end (headroom past the 50 fast threshold)
const DAMP_PAD = 4 // keep a small cap margin at each end

// zone tick offsets from center for the 25 / 50 mm/s boundaries
const tick25 = (25 / DAMP_MAX_MMS) * (DAMP_MID - DAMP_PAD)
const tick50 = (50 / DAMP_MAX_MMS) * (DAMP_MID - DAMP_PAD)

const fillLen = computed(() => clampUnit(Math.abs(props.damperVelocityMmS) / DAMP_MAX_MMS) * (DAMP_MID - DAMP_PAD))
const fillY = computed(() => props.damperVelocityMmS >= 0 ? DAMP_MID : DAMP_MID - fillLen.value)

const damperColor = computed(() => {
  const a = Math.abs(props.damperVelocityMmS)
  if (a >= 50) return '#f59e0b' // fast (amber)
  if (a >= 25) return '#a1a1aa' // medium (zinc-400)
  return '#52525b' // slow (zinc-600)
})

const damperVelocityText = computed(() => {
  const v = Math.round(props.damperVelocityMmS)
  return (v > 0 ? '+' : '') + v
})
</script>

<template>
  <div class="flex flex-col gap-1.5 font-mono">
    <NuxtLink
      to="/tune/springs"
      class="group inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-green-300"
    >
      <span>SUSP</span>
      <UIcon
        name="i-lucide-arrow-up-right"
        class="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70"
      />
    </NuxtLink>

    <div class="flex flex-1 items-stretch gap-1.5">
      <!-- Coil spring -->
      <svg
        viewBox="0 0 40 100"
        preserveAspectRatio="xMidYMid meet"
        class="h-full w-12"
        :class="{ 'animate-pulse': bottoming }"
      >
        <!-- bottoming / bump-stop band at the fully-compressed limit -->
        <rect
          x="2"
          :y="CAP_BOT - 1"
          width="36"
          height="3"
          rx="1"
          fill="#ef4444"
          :opacity="bottoming ? 0.9 : 0.25"
        />
        <!-- chassis-side cap (descends under compression) -->
        <line
          :x1="CX - AMP - 3"
          :y1="yTop"
          :x2="CX + AMP + 3"
          :y2="yTop"
          :stroke="stroke"
          stroke-width="2.2"
          stroke-linecap="round"
        />
        <!-- hub/road-side mounting cap (fixed at the base) -->
        <line
          :x1="CX - AMP - 3"
          :y1="CAP_BOT"
          :x2="CX + AMP + 3"
          :y2="CAP_BOT"
          :stroke="stroke"
          stroke-width="2.2"
          stroke-linecap="round"
        />
        <!-- coil -->
        <path
          :d="coilPath"
          fill="none"
          :stroke="stroke"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>

      <!-- Damper-velocity zone bar -->
      <svg
        viewBox="0 0 12 100"
        preserveAspectRatio="none"
        class="h-full w-3"
      >
        <rect
          x="0"
          y="0"
          width="12"
          height="100"
          rx="1.5"
          fill="#27272a"
        />
        <!-- zone ticks (±25, ±50 mm/s) -->
        <line
          v-for="off in [tick25, tick50]"
          :key="'u' + off"
          x1="0"
          :y1="DAMP_MID - off"
          x2="12"
          :y2="DAMP_MID - off"
          stroke="#3f3f46"
          stroke-width="0.5"
        />
        <line
          v-for="off in [tick25, tick50]"
          :key="'d' + off"
          x1="0"
          :y1="DAMP_MID + off"
          x2="12"
          :y2="DAMP_MID + off"
          stroke="#3f3f46"
          stroke-width="0.5"
        />
        <!-- fill: compression grows down from center, rebound up -->
        <rect
          x="1.5"
          :y="fillY"
          width="9"
          :height="fillLen"
          rx="1"
          :fill="damperColor"
        />
        <!-- zero reference -->
        <line
          x1="0"
          :y1="DAMP_MID"
          x2="12"
          :y2="DAMP_MID"
          stroke="#71717a"
          stroke-width="0.7"
        />
      </svg>
    </div>

    <!-- readouts -->
    <div class="flex items-baseline justify-between text-[10px] tabular-nums">
      <span
        :style="{ color: damperColor }"
        title="Damper velocity: +ve compression, -ve rebound · |v|>50 mm/s is the fast zone"
      >{{ damperVelocityText }}<span class="ml-0.5 text-zinc-600">mm/s</span></span>
      <span class="text-zinc-500">{{ format.distanceShort(suspensionMeters) }}</span>
    </div>
  </div>
</template>
