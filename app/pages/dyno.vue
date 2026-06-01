<script setup lang="ts">
import { emptyDynoState, ingestFrame, snapshot, type DynoState } from '~/utils/dyno'

useHead({ title: 'Dyno · co-driver' })

const { telemetry, hasReceivedFrame, connected } = useTelemetry()

// Page-lifetime accumulator. Mutating a non-reactive object and bumping a
// `version` ref is cheaper than wrapping the Map in a reactive proxy — Vue
// would have to traverse every bucket on every change otherwise.
let state: DynoState = emptyDynoState()
const version = ref(0)
const lastCarOrdinal = ref<number | null>(null)

const curve = computed(() => {
  // version is read so this recomputes when ingestFrame bumps it
  void version.value
  return snapshot(state)
})

const currentRpm = computed(() => telemetry.value?.rpm ?? 0)
const carDisplay = computed(() => {
  const t = telemetry.value
  if (!t) return 'no telemetry'
  const ord = t.car.ordinal
  return ord > 0 ? `car #${ord} · PI ${t.car.pi}` : 'awaiting car data'
})

watch(telemetry, (t) => {
  if (!t || !t.isRaceOn) return
  // Reset if the car changed under us
  if (lastCarOrdinal.value !== null && t.car.ordinal !== lastCarOrdinal.value) {
    state = emptyDynoState()
  }
  lastCarOrdinal.value = t.car.ordinal
  ingestFrame(state, t)
  version.value++
})

function resetCurve() {
  state = emptyDynoState()
  lastCarOrdinal.value = telemetry.value?.car.ordinal ?? null
  version.value++
}
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <div class="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <span>
        Dyno
        <span class="ml-3 normal-case tracking-normal text-zinc-600">{{ carDisplay }}</span>
      </span>
      <UButton
        label="Reset curve"
        color="neutral"
        variant="outline"
        size="xs"
        class="font-mono text-[10px] uppercase tracking-[0.3em] hover:text-amber-300"
        @click="resetCurve"
      />
    </div>
    <h1 class="mb-2 font-mono text-3xl text-zinc-100">
      Gear-tuning workbench
    </h1>
    <p class="mb-8 max-w-2xl font-mono text-sm leading-relaxed text-zinc-400">
      Pick 3rd or 4th gear, roll down to about 2000 RPM, then hold full
      throttle to redline. The high gear keeps tires hooked so the curve
      fills cleanly from the bottom — 1st-gear launches skip the low end on
      wheelspin. Use peak power for shift point, the shaded band as your
      "stay-in-here" zone for gear spacing.
    </p>

    <TelemetryWaiting
      v-if="!hasReceivedFrame"
      :connected="connected"
      class="mb-6"
    >
      Enable Data Out in Forza and start a race or free-roam, then pick 3rd or
      4th gear and hold full throttle to redline — the curve fills as you pull.
    </TelemetryWaiting>

    <DynoCurve
      v-else
      :curve="curve"
      title="dyno"
      :subtitle="carDisplay"
      mode="detailed"
      :current-rpm="currentRpm"
    />

    <section class="mt-6 card p-4 font-mono text-sm leading-relaxed text-zinc-300">
      <div class="mb-2 text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        Gear tuning · quick rules
      </div>
      <p>
        Set the <span class="text-zinc-100">final drive</span> so 1st gear pulls
        to redline just past your launch speed. Then space the upper gears so each
        upshift drops the engine roughly 1000 RPM short of redline — that lands
        you back inside the shaded powerband.
      </p>
      <p class="mt-2 text-zinc-400">
        Avoid gaps that drop you below peak torque. Avoid stacks that have you
        shifting twice through the same RPM band.
      </p>
      <NuxtLink
        to="/tune/gearing"
        class="mt-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.3em] text-green-400 transition-colors hover:text-green-300"
      >
        Full gearing reference →
      </NuxtLink>
    </section>
  </main>
</template>
