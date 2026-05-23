<script setup lang="ts">
import type { Telemetry } from '../../server/utils/decode'
import type { DebugFrame } from '../../server/utils/forza-bus'

const props = defineProps<{
  telemetry: Telemetry | null
  debug: DebugFrame | null
}>()

const { format, unitLabel } = useUnits()

const open = ref(false)
function toggle() {
  open.value = !open.value
}

onMounted(() => {
  const handler = (e: KeyboardEvent) => {
    // Don't intercept typing in inputs.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === 'd' || e.key === 'D') toggle()
  }
  window.addEventListener('keydown', handler)
  onBeforeUnmount(() => window.removeEventListener('keydown', handler))
})

function fmt(v: unknown, digits = 3): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(digits) : String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

interface Field {
  label: string
  value: unknown
  digits?: number
  /** When set, skip `fmt(value, digits)` and render this string directly. */
  display?: string
}

interface Section {
  title: string
  fields: Field[]
}

const sections = computed<Section[]>(() => {
  const t = props.telemetry
  if (!t) return []
  return [
    {
      title: 'race / time',
      fields: [
        { label: 'isRaceOn', value: t.isRaceOn },
        { label: 'timestampMs', value: t.timestampMs, digits: 0 },
        { label: 'raceTime', value: t.lap.raceTime }
      ]
    },
    {
      title: 'powertrain',
      fields: [
        { label: 'rpm', value: t.rpm, digits: 0 },
        { label: 'rpmMax', value: t.rpmMax, digits: 0 },
        { label: 'rpmIdle', value: t.rpmIdle, digits: 0 },
        { label: 'gear', value: t.gear, digits: 0 },
        { label: 'power (W)', value: t.power, digits: 0 },
        { label: `torque (${unitLabel.torque})`, value: t.torque, display: format.torque(t.torque) },
        { label: 'boost', value: t.boost }
      ]
    },
    {
      title: 'inputs',
      fields: [
        { label: 'throttle', value: t.throttle },
        { label: 'brake', value: t.brake },
        { label: 'clutch', value: t.clutch },
        { label: 'handBrake', value: t.handBrake },
        { label: 'steer', value: t.steer }
      ]
    },
    {
      title: 'motion',
      fields: [
        { label: `speed (${unitLabel.speed})`, value: t.speedKmh, display: format.speed(t.speedKmh) },
        { label: 'yaw', value: t.yaw },
        { label: 'pitch', value: t.pitch },
        { label: 'roll', value: t.roll },
        { label: 'velocity.x', value: t.velocity.x, digits: 2 },
        { label: 'velocity.y', value: t.velocity.y, digits: 2 },
        { label: 'velocity.z', value: t.velocity.z, digits: 2 }
      ]
    },
    {
      title: 'suspension (normalized)',
      fields: [
        { label: 'fl', value: t.suspension.fl },
        { label: 'fr', value: t.suspension.fr },
        { label: 'rl', value: t.suspension.rl },
        { label: 'rr', value: t.suspension.rr }
      ]
    },
    {
      title: `suspension (${unitLabel.distanceShort})`,
      fields: [
        { label: 'fl', value: t.suspensionMeters.fl, display: format.distanceShort(t.suspensionMeters.fl) },
        { label: 'fr', value: t.suspensionMeters.fr, display: format.distanceShort(t.suspensionMeters.fr) },
        { label: 'rl', value: t.suspensionMeters.rl, display: format.distanceShort(t.suspensionMeters.rl) },
        { label: 'rr', value: t.suspensionMeters.rr, display: format.distanceShort(t.suspensionMeters.rr) }
      ]
    },
    {
      title: 'slip ratio',
      fields: [
        { label: 'fl', value: t.slipRatio.fl },
        { label: 'fr', value: t.slipRatio.fr },
        { label: 'rl', value: t.slipRatio.rl },
        { label: 'rr', value: t.slipRatio.rr }
      ]
    },
    {
      title: 'slip angle',
      fields: [
        { label: 'fl', value: t.slipAngle.fl },
        { label: 'fr', value: t.slipAngle.fr },
        { label: 'rl', value: t.slipAngle.rl },
        { label: 'rr', value: t.slipAngle.rr }
      ]
    },
    {
      title: 'combined slip',
      fields: [
        { label: 'fl', value: t.combinedSlip.fl },
        { label: 'fr', value: t.combinedSlip.fr },
        { label: 'rl', value: t.combinedSlip.rl },
        { label: 'rr', value: t.combinedSlip.rr }
      ]
    },
    {
      title: `tire temp (${unitLabel.temperature})`,
      fields: [
        { label: 'fl', value: t.tireTempC.fl, display: format.temp(t.tireTempC.fl) },
        { label: 'fr', value: t.tireTempC.fr, display: format.temp(t.tireTempC.fr) },
        { label: 'rl', value: t.tireTempC.rl, display: format.temp(t.tireTempC.rl) },
        { label: 'rr', value: t.tireTempC.rr, display: format.temp(t.tireTempC.rr) }
      ]
    },
    {
      title: 'lap',
      fields: [
        { label: 'number', value: t.lap.number, digits: 0 },
        { label: 'racePosition', value: t.lap.racePosition, digits: 0 },
        { label: 'current (s)', value: t.lap.current, digits: 3 },
        { label: 'last (s)', value: t.lap.last, digits: 3 },
        { label: 'best (s)', value: t.lap.best, digits: 3 },
        { label: 'distance', value: t.lap.distance, display: format.distance(t.lap.distance) }
      ]
    },
    {
      title: 'car',
      fields: [
        { label: 'ordinal', value: t.car.ordinal, digits: 0 },
        { label: 'class', value: t.car.class, digits: 0 },
        { label: 'pi', value: t.car.pi, digits: 0 },
        { label: 'drivetrain', value: t.car.drivetrain, digits: 0 },
        { label: 'cylinders', value: t.car.cylinders, digits: 0 }
      ]
    },
    {
      title: 'packet',
      fields: [
        { label: 'rawLength', value: t.rawLength, digits: 0 },
        { label: 'tail hex (last 8)', value: props.debug?.tailHex ?? '—' }
      ]
    }
  ]
})
</script>

<template>
  <div class="pointer-events-none fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col">
    <button
      type="button"
      class="pointer-events-auto self-end rounded-l-md border border-r-0 border-zinc-800 bg-zinc-900/90 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400 hover:text-zinc-100"
      @click="toggle"
    >
      {{ open ? 'close [D]' : 'debug [D]' }}
    </button>
    <Transition
      enter-active-class="transition-transform duration-150"
      leave-active-class="transition-transform duration-150"
      enter-from-class="translate-x-full"
      leave-to-class="translate-x-full"
    >
      <div
        v-show="open"
        class="pointer-events-auto flex-1 overflow-y-auto border-l border-zinc-800 bg-zinc-950/95 p-4 font-mono text-[11px] text-zinc-200 backdrop-blur"
      >
        <div class="mb-3 flex items-center justify-between">
          <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Raw telemetry</span>
          <span
            v-if="debug"
            class="text-[10px] text-zinc-500"
          >
            packet {{ debug.length }}B
          </span>
        </div>

        <div
          v-if="!telemetry"
          class="text-zinc-500"
        >
          No telemetry yet.
        </div>

        <div
          v-for="section in sections"
          :key="section.title"
          class="mb-4"
        >
          <div class="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            {{ section.title }}
          </div>
          <div class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            <template
              v-for="field in section.fields"
              :key="field.label"
            >
              <span class="text-zinc-400">{{ field.label }}</span>
              <span class="tabular-nums text-zinc-100">{{ field.display ?? fmt(field.value, field.digits) }}</span>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
