<script setup lang="ts">
import type { Telemetry } from '../../server/utils/decode'
import { useSustained } from '~/composables/useSustained'

const props = defineProps<{
  frame: Telemetry | null
  paused: boolean
}>()

// Comparative diagnostic chips: UNDERSTEER on the front pair when the front
// tires are notably more loaded than the rear AND the driver is asking for
// rotation; OVERSTEER mirrors. Floor at combinedSlip 0.7 so straight-line
// noise doesn't trigger anything. 250 ms debounce so transient slip
// asymmetries (mid-corner correction) don't flash chips on screen.
const frontAvg = computed(() => {
  const c = props.frame?.combinedSlip
  if (!c) return 0
  return (c.fl + c.fr) / 2
})
const rearAvg = computed(() => {
  const c = props.frame?.combinedSlip
  if (!c) return 0
  return (c.rl + c.rr) / 2
})
const absSteer = computed(() => Math.abs(props.frame?.steer ?? 0))
const anyEngaged = computed(() => Math.max(frontAvg.value, rearAvg.value) > 0.7)

const understeer = useSustained(
  () => anyEngaged.value && absSteer.value > 0.3 && (frontAvg.value - rearAvg.value) > 0.25,
  250
)
const oversteer = useSustained(
  () => anyEngaged.value && absSteer.value > 0.3 && (rearAvg.value - frontAvg.value) > 0.25,
  250
)

// Per-corner damper velocity (mm/s, signed: +ve = compression).
// Computed from frame-to-frame `suspensionMeters` delta. dt > 100 ms is
// treated as a seek / pause edge and the value held — this avoids one
// huge spike after a pause skews the live readout.
interface DamperVelocity { fl: number, fr: number, rl: number, rr: number }
interface PrevSusp {
  ts: number
  fl: number
  fr: number
  rl: number
  rr: number
}
const prevSusp = ref<PrevSusp | null>(null)
const damperVelocity = ref<DamperVelocity>({ fl: 0, fr: 0, rl: 0, rr: 0 })

watch(() => props.frame, (f) => {
  if (!f) return
  const cur: PrevSusp = {
    ts: f.timestampMs,
    fl: f.suspensionMeters.fl,
    fr: f.suspensionMeters.fr,
    rl: f.suspensionMeters.rl,
    rr: f.suspensionMeters.rr
  }
  const p = prevSusp.value
  if (p) {
    const dtSec = (cur.ts - p.ts) / 1000
    if (dtSec > 0 && dtSec < 0.1) {
      damperVelocity.value = {
        fl: (cur.fl - p.fl) / dtSec * 1000,
        fr: (cur.fr - p.fr) / dtSec * 1000,
        rl: (cur.rl - p.rl) / dtSec * 1000,
        rr: (cur.rr - p.rr) / dtSec * 1000
      }
    }
  }
  prevSusp.value = cur
})

// Whether to show the boost gauge. Forza telemetry doesn't expose aspiration,
// so we latch once observed boost (gauge PSI) crosses a small threshold and
// reset on a car change: an NA car never exceeds ~0 psi (it only pulls vacuum,
// i.e. negative), while a forced-induction car trips it the first time it
// spools. Validated against session 22 (NA car, peak boost 0.0 psi).
const BOOST_DETECT_PSI = 0.5
const hasBoost = ref(false)
let boostCar: number | null = null
watch(() => props.frame, (f) => {
  if (!f) return
  if (f.car.ordinal !== boostCar) {
    boostCar = f.car.ordinal
    hasBoost.value = false
  }
  if (f.boost > BOOST_DETECT_PSI) hasBoost.value = true
})
</script>

<template>
  <main
    class="relative grid gap-4 px-6 py-6"
    style="grid-template-columns: 1fr 1.4fr 1fr; grid-template-rows: 1fr 1fr;"
  >
    <CornerPanel
      label="FRONT LEFT"
      side="left"
      :suspension="frame?.suspension.fl ?? 0"
      :suspension-meters="frame?.suspensionMeters.fl ?? 0"
      :damper-velocity-mm-s="damperVelocity.fl"
      :slip-ratio="frame?.slipRatio.fl ?? 0"
      :slip-angle="frame?.slipAngle.fl ?? 0"
      :combined-slip="frame?.combinedSlip.fl ?? 0"
      :temp-c="frame?.tireTempC.fl ?? 0"
      :rumble="frame?.rumble.fl ?? false"
      :understeer="understeer"
    />
    <CenterPanel
      class="row-span-2"
      :rpm="frame?.rpm ?? 0"
      :rpm-max="frame?.rpmMax ?? 8000"
      :rpm-idle="frame?.rpmIdle ?? 800"
      :gear="frame?.gear ?? 1"
      :speed-kmh="frame?.speedKmh ?? 0"
      :throttle="frame?.throttle ?? 0"
      :brake="frame?.brake ?? 0"
      :steer="frame?.steer ?? 0"
      :boost="frame?.boost ?? 0"
      :has-boost="hasBoost"
      :power="frame?.power ?? 0"
      :accel-long="frame?.acceleration.z ?? 0"
      :accel-lat="frame?.acceleration.x ?? 0"
      :roll="frame?.roll ?? 0"
      :pitch="frame?.pitch ?? 0"
      :yaw-rate="frame?.angularVelocity.y ?? 0"
    />
    <CornerPanel
      label="FRONT RIGHT"
      side="right"
      :suspension="frame?.suspension.fr ?? 0"
      :suspension-meters="frame?.suspensionMeters.fr ?? 0"
      :damper-velocity-mm-s="damperVelocity.fr"
      :slip-ratio="frame?.slipRatio.fr ?? 0"
      :slip-angle="frame?.slipAngle.fr ?? 0"
      :combined-slip="frame?.combinedSlip.fr ?? 0"
      :temp-c="frame?.tireTempC.fr ?? 0"
      :rumble="frame?.rumble.fr ?? false"
      :understeer="understeer"
    />
    <CornerPanel
      label="REAR LEFT"
      side="left"
      :suspension="frame?.suspension.rl ?? 0"
      :suspension-meters="frame?.suspensionMeters.rl ?? 0"
      :damper-velocity-mm-s="damperVelocity.rl"
      :slip-ratio="frame?.slipRatio.rl ?? 0"
      :slip-angle="frame?.slipAngle.rl ?? 0"
      :combined-slip="frame?.combinedSlip.rl ?? 0"
      :temp-c="frame?.tireTempC.rl ?? 0"
      :rumble="frame?.rumble.rl ?? false"
      :oversteer="oversteer"
    />
    <CornerPanel
      label="REAR RIGHT"
      side="right"
      :suspension="frame?.suspension.rr ?? 0"
      :suspension-meters="frame?.suspensionMeters.rr ?? 0"
      :damper-velocity-mm-s="damperVelocity.rr"
      :slip-ratio="frame?.slipRatio.rr ?? 0"
      :slip-angle="frame?.slipAngle.rr ?? 0"
      :combined-slip="frame?.combinedSlip.rr ?? 0"
      :temp-c="frame?.tireTempC.rr ?? 0"
      :rumble="frame?.rumble.rr ?? false"
      :oversteer="oversteer"
    />

    <div
      v-if="paused"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div class="border-y border-zinc-700/60 bg-zinc-950/40 px-12 py-3 backdrop-blur-sm">
        <div class="font-mono text-2xl uppercase tracking-[0.5em] text-zinc-100">
          PAUSED
        </div>
        <div class="text-center font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          no race active — last frame frozen
        </div>
      </div>
    </div>
  </main>
</template>
