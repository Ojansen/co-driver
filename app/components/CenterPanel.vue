<script setup lang="ts">
import { gearLabel } from '~/utils/tuning'

const props = defineProps<{
  rpm: number
  rpmMax: number
  rpmIdle: number
  gear: number
  speedKmh: number
  throttle: number
  brake: number
  steer: number
  boost: number
  /** body-frame longitudinal acceleration (m/s²) — +ve forward */
  accelLong: number
  /** body-frame lateral acceleration (m/s²) — +ve to one side */
  accelLat: number
  /** chassis roll in radians */
  roll: number
  /** chassis pitch in radians */
  pitch: number
  /** yaw rate, rad/s — sign matches steer direction */
  yawRate: number
}>()

const rpmPct = computed(() => {
  if (props.rpmMax <= 0) return 0
  return Math.min(100, Math.max(0, (props.rpm / props.rpmMax) * 100))
})

// Redline shading from ~85% upwards
const rpmRedlinePct = computed(() => {
  if (props.rpmMax <= 0) return 100
  return Math.max(0, Math.min(100, ((props.rpmMax * 0.85) / props.rpmMax) * 100))
})

const rpmBarColor = computed(() => {
  const r = props.rpm / Math.max(props.rpmMax, 1)
  if (r > 0.95) return '#ef4444'
  if (r > 0.85) return '#f59e0b'
  return '#22c55e'
})

const steerPct = computed(() => (props.steer + 1) * 50)

// --- G-G dot ---------------------------------------------------------------
// 2g range on each axis. Convention: lateral on X, longitudinal on Y with
// braking UP (negative accelLong = upper half).
const G_RANGE_MPS2 = 20 // ≈ 2g
const TRAIL_SAMPLES = 60 // ~1 second of 60 Hz history

interface GPoint { x: number, y: number }
const trail = ref<GPoint[]>([])

function ggDot(): GPoint {
  const xs = 50 + clamp(props.accelLat / G_RANGE_MPS2, -1, 1) * 48
  // Braking (negative accelLong) plots toward the top of the SVG.
  const ys = 50 - clamp(props.accelLong / G_RANGE_MPS2, -1, 1) * 48
  return { x: xs, y: ys }
}

watch(() => [props.accelLat, props.accelLong] as const, () => {
  trail.value.push(ggDot())
  if (trail.value.length > TRAIL_SAMPLES) trail.value.shift()
}, { immediate: true })

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

const dotPos = computed<GPoint>(() => ggDot())

const trailPath = computed(() => {
  const pts = trail.value
  if (pts.length < 2) return ''
  let out = ''
  for (let i = 0; i < pts.length; i++) {
    out += (i === 0 ? 'M' : 'L') + pts[i]!.x.toFixed(1) + ',' + pts[i]!.y.toFixed(1) + ' '
  }
  return out.trim()
})

const lateralG = computed(() => props.accelLat / 9.81)
const longG = computed(() => props.accelLong / 9.81)
const radToDeg = (rad: number): number => rad * 57.2957795

function signedFixed(v: number, digits: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(digits)
}
</script>

<template>
  <div class="flex h-full flex-col items-stretch justify-between rounded-lg border border-zinc-800 bg-zinc-900/80 p-5 font-mono text-zinc-100 backdrop-blur">
    <!-- Top: gear + speed -->
    <div class="flex items-start justify-between">
      <div>
        <div class="text-xs uppercase tracking-[0.2em] text-zinc-400">
          GEAR
        </div>
        <div class="text-8xl leading-none font-light tabular-nums">
          {{ gearLabel(gear) }}
        </div>
      </div>
      <div class="text-right">
        <div class="text-xs uppercase tracking-[0.2em] text-zinc-400">
          KM/H
        </div>
        <div class="text-6xl leading-none font-light tabular-nums">
          {{ Math.round(speedKmh) }}
        </div>
      </div>
    </div>

    <!-- Middle: RPM linear bar -->
    <div class="mt-5">
      <div class="flex justify-between text-sm text-zinc-400">
        <span>RPM</span>
        <span class="tabular-nums text-base text-zinc-200">{{ Math.round(rpm) }} <span class="text-zinc-500">/ {{ Math.round(rpmMax) }}</span></span>
      </div>
      <svg
        viewBox="0 0 100 10"
        class="mt-1 w-full"
        preserveAspectRatio="none"
      >
        <rect
          x="0"
          y="0"
          width="100"
          height="10"
          rx="1"
          fill="#27272a"
        />
        <!-- redline zone shading -->
        <rect
          :x="rpmRedlinePct"
          y="0"
          :width="100 - rpmRedlinePct"
          height="10"
          fill="#7f1d1d"
          opacity="0.4"
        />
        <!-- current rpm -->
        <rect
          x="0"
          y="0"
          :width="rpmPct"
          height="10"
          rx="1"
          :fill="rpmBarColor"
        />
        <!-- 85% tick -->
        <line
          :x1="rpmRedlinePct"
          y1="0"
          :x2="rpmRedlinePct"
          y2="10"
          stroke="#52525b"
          stroke-width="0.5"
        />
      </svg>
    </div>

    <!-- Inputs strip -->
    <div class="mt-5 space-y-2.5">
      <div class="flex items-center gap-2 text-sm text-zinc-400">
        <span class="w-16">THROTL</span>
        <div class="h-2.5 flex-1 overflow-hidden rounded bg-zinc-800">
          <div
            class="h-full bg-green-500"
            :style="{ width: (throttle * 100) + '%' }"
          />
        </div>
        <span class="w-10 text-right tabular-nums text-zinc-200">{{ Math.round(throttle * 100) }}</span>
      </div>
      <div class="flex items-center gap-2 text-sm text-zinc-400">
        <span class="w-16">BRAKE</span>
        <div class="h-2.5 flex-1 overflow-hidden rounded bg-zinc-800">
          <div
            class="h-full bg-red-500"
            :style="{ width: (brake * 100) + '%' }"
          />
        </div>
        <span class="w-10 text-right tabular-nums text-zinc-200">{{ Math.round(brake * 100) }}</span>
      </div>
      <div class="flex items-center gap-2 text-sm text-zinc-400">
        <span class="w-16">STEER</span>
        <div class="relative h-2.5 flex-1 overflow-hidden rounded bg-zinc-800">
          <div
            class="absolute top-0 h-full w-px bg-zinc-600"
            style="left: 50%;"
          />
          <div
            class="absolute top-0 h-full bg-amber-400"
            :style="steer >= 0
              ? { left: '50%', width: (steer * 50) + '%' }
              : { right: '50%', width: (-steer * 50) + '%' }"
          />
        </div>
        <span class="w-10 text-right tabular-nums text-zinc-200">{{ Math.round(steerPct - 50) }}</span>
      </div>
    </div>

    <!-- Chassis strip: G-G dot + attitude/rotation readouts -->
    <div class="mt-5 flex items-stretch gap-4">
      <!-- G-G dot — dominant chassis visualization -->
      <div class="relative shrink-0">
        <svg
          viewBox="0 0 100 100"
          class="h-56 w-56"
        >
          <defs>
            <radialGradient id="ggBackdrop">
              <stop
                offset="0%"
                stop-color="#0f0f12"
              />
              <stop
                offset="100%"
                stop-color="#18181b"
              />
            </radialGradient>
            <filter
              id="ggDotGlow"
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
          </defs>

          <!-- backdrop -->
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="url(#ggBackdrop)"
            stroke="#3f3f46"
            stroke-width="0.6"
          />
          <!-- crosshair -->
          <line
            x1="50"
            y1="3"
            x2="50"
            y2="97"
            stroke="#52525b"
            stroke-width="0.4"
          />
          <line
            x1="3"
            y1="50"
            x2="97"
            y2="50"
            stroke="#52525b"
            stroke-width="0.4"
          />
          <!-- 1g ring (inner) and 2g ring (outer) -->
          <circle
            cx="50"
            cy="50"
            r="24"
            fill="none"
            stroke="#52525b"
            stroke-width="0.4"
            stroke-dasharray="2,2"
          />
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke="#3f3f46"
            stroke-width="0.4"
            stroke-dasharray="1,2"
          />
          <!-- axis ticks at 1g and 2g -->
          <g
            stroke="#52525b"
            stroke-width="0.5"
          >
            <line
              x1="26"
              y1="48"
              x2="26"
              y2="52"
            />
            <line
              x1="74"
              y1="48"
              x2="74"
              y2="52"
            />
            <line
              x1="48"
              y1="26"
              x2="52"
              y2="26"
            />
            <line
              x1="48"
              y1="74"
              x2="52"
              y2="74"
            />
          </g>
          <!-- ring labels -->
          <text
            x="50"
            y="28.5"
            text-anchor="middle"
            fill="#52525b"
            font-size="3.2"
            font-family="monospace"
          >1g</text>
          <text
            x="50"
            y="4.5"
            text-anchor="middle"
            fill="#3f3f46"
            font-size="3.2"
            font-family="monospace"
          >2g</text>
          <!-- trail of the last ~1 s with glow -->
          <path
            :d="trailPath"
            fill="none"
            stroke="#f59e0b"
            stroke-width="1.6"
            stroke-linejoin="round"
            stroke-linecap="round"
            opacity="0.6"
            filter="url(#ggDotGlow)"
          />
          <path
            :d="trailPath"
            fill="none"
            stroke="#fbbf24"
            stroke-width="1.1"
            stroke-linejoin="round"
            stroke-linecap="round"
            opacity="0.85"
          />
          <!-- current point — glow + solid -->
          <circle
            :cx="dotPos.x"
            :cy="dotPos.y"
            r="4.2"
            fill="#22c55e"
            opacity="0.4"
            filter="url(#ggDotGlow)"
          />
          <circle
            :cx="dotPos.x"
            :cy="dotPos.y"
            r="3"
            fill="#4ade80"
            stroke="#0f0f12"
            stroke-width="0.6"
          />
        </svg>
        <div class="absolute top-2 left-2 text-xs uppercase tracking-[0.25em] text-zinc-500">
          G-G
        </div>
        <div class="absolute right-2 bottom-2 font-mono text-xs tabular-nums text-zinc-300">
          {{ signedFixed(lateralG, 2) }} <span class="text-zinc-500">·</span> {{ signedFixed(longG, 2) }} <span class="text-zinc-500">g</span>
        </div>
      </div>

      <!-- Attitude + rotation readouts -->
      <div class="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 self-center text-sm">
        <div class="flex items-center justify-between text-zinc-400">
          <span>ROLL</span>
          <span class="text-lg tabular-nums text-zinc-100">{{ signedFixed(radToDeg(roll), 1) }}°</span>
        </div>
        <div class="flex items-center justify-between text-zinc-400">
          <span>PITCH</span>
          <span class="text-lg tabular-nums text-zinc-100">{{ signedFixed(radToDeg(pitch), 1) }}°</span>
        </div>
        <div class="flex items-center justify-between text-zinc-400">
          <span>YAW/s</span>
          <span class="text-lg tabular-nums text-zinc-100">{{ signedFixed(yawRate, 2) }}</span>
        </div>
        <div class="flex items-center justify-between text-zinc-400">
          <span>BOOST</span>
          <span class="text-lg tabular-nums text-zinc-100">{{ boost.toFixed(2) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
