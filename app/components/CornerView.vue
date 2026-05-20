<script setup lang="ts">
import type { Telemetry } from '../../server/utils/decode'

defineProps<{
  frame: Telemetry | null
  paused: boolean
}>()
</script>

<template>
  <main
    class="relative mx-auto grid max-w-6xl gap-4 px-6 py-6"
    style="grid-template-columns: 1fr 1.4fr 1fr; grid-template-rows: 1fr 1fr;"
  >
    <CornerPanel
      label="FRONT LEFT"
      side="left"
      :suspension="frame?.suspension.fl ?? 0"
      :slip-ratio="frame?.slipRatio.fl ?? 0"
      :slip-angle="frame?.slipAngle.fl ?? 0"
      :temp-c="frame?.tireTempC.fl ?? 0"
      :rumble="frame?.rumble.fl ?? false"
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
    />
    <CornerPanel
      label="FRONT RIGHT"
      side="right"
      :suspension="frame?.suspension.fr ?? 0"
      :slip-ratio="frame?.slipRatio.fr ?? 0"
      :slip-angle="frame?.slipAngle.fr ?? 0"
      :temp-c="frame?.tireTempC.fr ?? 0"
      :rumble="frame?.rumble.fr ?? false"
    />
    <CornerPanel
      label="REAR LEFT"
      side="left"
      :suspension="frame?.suspension.rl ?? 0"
      :slip-ratio="frame?.slipRatio.rl ?? 0"
      :slip-angle="frame?.slipAngle.rl ?? 0"
      :temp-c="frame?.tireTempC.rl ?? 0"
      :rumble="frame?.rumble.rl ?? false"
    />
    <CornerPanel
      label="REAR RIGHT"
      side="right"
      :suspension="frame?.suspension.rr ?? 0"
      :slip-ratio="frame?.slipRatio.rr ?? 0"
      :slip-angle="frame?.slipAngle.rr ?? 0"
      :temp-c="frame?.tireTempC.rr ?? 0"
      :rumble="frame?.rumble.rr ?? false"
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
