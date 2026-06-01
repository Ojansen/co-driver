<script setup lang="ts">
import { tempColor, slipColor, combColor, SUSPENSION_BOTTOMING } from '~/utils/tuning'
import { useSustained } from '~/composables/useSustained'

const { unitLabel } = useUnits()

const props = withDefaults(defineProps<{
  label: string
  side: 'left' | 'right'
  suspension: number
  /** absolute travel in meters from the Dash packet */
  suspensionMeters: number
  /** signed damper velocity in mm/s — positive = compression, negative = rebound.
   *  Computed by the parent from frame-to-frame `suspensionMeters` delta. */
  damperVelocityMmS?: number
  slipRatio: number
  slipAngle: number
  combinedSlip: number
  tempC: number
  rumble: boolean
  /** comparative chip: front-pair shows it when the car is pushing wide */
  understeer?: boolean
  /** comparative chip: rear-pair shows it when the rear is on a longer leash */
  oversteer?: boolean
}>(), {
  damperVelocityMmS: 0,
  understeer: false,
  oversteer: false
})

const bottoming = computed(() => props.suspension > SUSPENSION_BOTTOMING)
const temp = computed(() => tempColor(props.tempC))
const ratioColor = computed(() => slipColor(Math.abs(props.slipRatio)))
const angleColor = computed(() => slipColor(Math.abs(props.slipAngle)))
const combinedColor = computed(() => combColor(props.combinedSlip))
const align = computed(() => props.side === 'left' ? 'text-left' : 'text-right')

// --- Diagnostic chips ------------------------------------------------------
// Each chip is a single threshold rule, sustained briefly to kill transients.
// Conservative thresholds; calibrate by driving with them visible.
const chipBottoming = useSustained(() => props.suspension > SUSPENSION_BOTTOMING, 150)
const chipLockup = useSustained(() => props.slipRatio < -0.15, 150)
const chipWheelspin = useSustained(() => props.slipRatio > 0.20, 150)
const chipPastGrip = useSustained(() => props.combinedSlip > 1.1, 200)

// --- friction-circle dot --------------------------------------------------
// 100×100 viewBox, center at (50,50). Friction limit (combinedSlip = 1.0)
// at radius = LIMIT_R; the dot exits this ring when the tire goes past grip.
const LIMIT_R = 32
const TRAIL_SAMPLES = 30 // ~0.5 s at 60 Hz

interface FrPoint { x: number, y: number }
const trail = ref<FrPoint[]>([])

// Place the dot so its DIRECTION comes from the raw (slipAngle, slipRatio) load
// mix, but its RADIUS tracks `combinedSlip` — Forza's already-normalized
// resultant where 1.0 = peak grip. That makes the rings honest: the dot touches
// the dashed ring at 70% of grip, crosses the solid LIMIT_R ring exactly when
// combinedSlip > 1.0 (i.e. when the "Past grip" chip fires).
// Convention matches the chassis G-G dot: forward drive force (positive
// slipRatio = wheelspin) plots DOWN, lockup (negative slipRatio) plots UP;
// slipAngle on X with positive to the right.
function project(slipAngle: number, slipRatio: number, combinedSlip: number): FrPoint {
  const mag = Math.hypot(slipAngle, slipRatio)
  if (mag < 1e-6) return { x: 50, y: 50 }
  const r = combinedSlip * LIMIT_R
  return {
    x: 50 + (slipAngle / mag) * r,
    y: 50 + (slipRatio / mag) * r
  }
}

const dotPos = computed<FrPoint>(() => project(props.slipAngle, props.slipRatio, props.combinedSlip))

watch(() => [props.slipAngle, props.slipRatio, props.combinedSlip] as const, ([sa, sr, cs]) => {
  trail.value.push(project(sa, sr, cs))
  if (trail.value.length > TRAIL_SAMPLES) trail.value.shift()
}, { immediate: true })

const trailPath = computed(() => {
  const pts = trail.value
  if (pts.length < 2) return ''
  let out = ''
  for (let i = 0; i < pts.length; i++) {
    out += (i === 0 ? 'M' : 'L') + pts[i]!.x.toFixed(1) + ',' + pts[i]!.y.toFixed(1) + ' '
  }
  return out.trim()
})
</script>

<template>
  <div class="panel p-2 font-mono text-zinc-100 backdrop-blur sm:p-4">
    <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-400 sm:text-xs">
      <span>{{ label }}</span>
      <span
        v-if="rumble"
        class="rounded-sm bg-amber-400/20 px-1.5 py-0.5 text-amber-300"
      >RUMBLE</span>
    </div>

    <!-- Diagnostic chips — one threshold per chip, links to the matching /tune doc.
         Row is always rendered with a reserved height so chips appearing/
         disappearing doesn't shift the panel below them. -->
    <div class="mt-2 flex min-h-[1.5rem] flex-wrap gap-1">
      <NuxtLink
        v-if="chipBottoming"
        to="/tune/springs"
        class="rounded-sm border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-red-300 transition-colors hover:bg-red-500/20"
        title="Suspension hitting the bump stops — softer/longer springs or higher ride height"
      >
        Bottoming
      </NuxtLink>
      <NuxtLink
        v-if="chipPastGrip"
        to="/tune/alignment"
        class="rounded-sm border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-red-300 transition-colors hover:bg-red-500/20"
        title="Combined slip past the friction circle — this tire has lost grip"
      >
        Past grip
      </NuxtLink>
      <NuxtLink
        v-if="chipLockup"
        to="/tune/brakes"
        class="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20"
        title="Wheel locked under brake — shift brake bias or modulate pedal"
      >
        Lockup
      </NuxtLink>
      <NuxtLink
        v-if="chipWheelspin"
        to="/tune/differential"
        class="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20"
        title="Wheelspin under power — diff or throttle application"
      >
        Wheelspin
      </NuxtLink>
      <NuxtLink
        v-if="understeer"
        to="/tune/anti-roll-bars"
        class="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20"
        title="Front pair more loaded than rear — soften front ARB"
      >
        Understeer
      </NuxtLink>
      <NuxtLink
        v-if="oversteer"
        to="/tune/anti-roll-bars"
        class="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20"
        title="Rear pair more loaded than front — soften rear ARB"
      >
        Oversteer
      </NuxtLink>
    </div>

    <!-- Two modules: suspension (coil + damper) outboard, tire grip inboard.
         flex-row-reverse on the right wheels puts the spring on the outer
         edge of the car in both columns. -->
    <div
      class="mt-3 flex gap-3"
      :class="{ 'flex-row-reverse': side === 'right' }"
    >
      <SpringGauge
        class="shrink-0"
        :compression="suspension"
        :damper-velocity-mm-s="damperVelocityMmS"
        :suspension-meters="suspensionMeters"
        :bottoming="bottoming"
      />

      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <!-- Slip ratio + angle -->
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div :class="align">
            <div class="text-zinc-400">
              SLIP R
            </div>
            <div
              class="text-lg leading-none tabular-nums"
              :style="{ color: ratioColor }"
            >
              {{ slipRatio >= 0 ? '+' : '' }}{{ slipRatio.toFixed(2) }}
            </div>
          </div>
          <div :class="align">
            <div class="text-zinc-400">
              SLIP A
            </div>
            <div
              class="text-lg leading-none tabular-nums"
              :style="{ color: angleColor }"
            >
              {{ slipAngle >= 0 ? '+' : '' }}{{ slipAngle.toFixed(2) }}
            </div>
          </div>
        </div>

        <!-- Friction circle — dot direction from the (slipAngle, slipRatio) load
         mix, radius from combinedSlip (outer ring = 1.0 = peak grip). Working-
         zone ring is dashed at 0.7. -->
        <div>
          <div class="flex items-center justify-between text-xs">
            <NuxtLink
              to="/tune/alignment"
              class="group inline-flex items-center gap-1 text-zinc-400 transition-colors hover:text-green-300"
            >
              <span>FRICTION</span>
              <UIcon
                name="i-lucide-arrow-up-right"
                class="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70"
              />
            </NuxtLink>
            <span
              class="text-sm tabular-nums"
              :style="{ color: combinedColor }"
            >{{ combinedSlip.toFixed(2) }}</span>
          </div>
          <div class="mt-1.5 flex justify-center">
            <svg
              viewBox="0 0 100 100"
              class="aspect-square w-full max-w-24"
            >
              <!-- backdrop -->
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="#18181b"
              />
              <!-- crosshair -->
              <line
                x1="50"
                y1="6"
                x2="50"
                y2="94"
                stroke="#3f3f46"
                stroke-width="0.5"
              />
              <line
                x1="6"
                y1="50"
                x2="94"
                y2="50"
                stroke="#3f3f46"
                stroke-width="0.5"
              />
              <!-- working-zone ring (0.7) -->
              <circle
                cx="50"
                cy="50"
                :r="LIMIT_R * 0.7"
                fill="none"
                stroke="#3f3f46"
                stroke-width="0.5"
                stroke-dasharray="1.5,1.5"
              />
              <!-- friction-limit ring (1.0) — solid -->
              <circle
                cx="50"
                cy="50"
                :r="LIMIT_R"
                fill="none"
                stroke="#52525b"
                stroke-width="0.7"
              />
              <!-- trail -->
              <path
                :d="trailPath"
                fill="none"
                stroke="#fbbf24"
                stroke-width="1"
                stroke-linejoin="round"
                stroke-linecap="round"
                opacity="0.55"
              />
              <!-- current point -->
              <circle
                :cx="dotPos.x"
                :cy="dotPos.y"
                r="3"
                :fill="combinedColor"
                stroke="#0f0f12"
                stroke-width="0.5"
              />
            </svg>
          </div>
        </div>

        <!-- Tire temp -->
        <div class="flex items-center gap-2">
          <span
            class="inline-block h-3.5 w-3.5 rounded-sm"
            :style="{ background: temp }"
          />
          <span class="text-sm tabular-nums">{{ unitLabel.temperature === '°F' ? (tempC * 9 / 5 + 32).toFixed(0) : tempC.toFixed(0) }}<span class="text-zinc-500 text-[10px]">{{ unitLabel.temperature }}</span></span>
          <NuxtLink
            to="/tune/tire-pressure"
            class="group ml-auto inline-flex items-center gap-1 text-xs uppercase tracking-wider text-zinc-500 transition-colors hover:text-green-300"
          >
            <span>TIRE</span>
            <UIcon
              name="i-lucide-arrow-up-right"
              class="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70"
            />
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
