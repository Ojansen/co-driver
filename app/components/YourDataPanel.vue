<script setup lang="ts">
import { TUNE_DATA_BINDINGS } from '~/utils/tune-data-bindings'

const props = defineProps<{ slug: string }>()

const { data } = useTuneData()

const binding = computed(() => TUNE_DATA_BINDINGS[props.slug] ?? null)

const rows = computed(() => {
  if (!binding.value || !data.value) return null
  return binding.value({ signals: data.value.signals, drivetrain: data.value.drivetrain })
})

const carLabel = computed(() => {
  const c = data.value?.car
  if (!c) return null
  return c.displayName ?? `Car #${c.ordinal}`
})

const buildLabel = computed(() => data.value?.build?.name ?? null)
</script>

<template>
  <section
    v-if="data && rows !== null && data.lapCount > 0"
    class="mb-10 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 font-mono"
  >
    <header class="mb-3 flex items-baseline justify-between text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <span>Your data</span>
      <span class="normal-case tracking-normal text-zinc-400">
        <span class="text-zinc-200">{{ carLabel }}</span>
        <template v-if="buildLabel">
          <span class="mx-1.5 text-zinc-600">·</span>
          <span class="text-zinc-300">{{ buildLabel }}</span>
        </template>
        <span class="mx-1.5 text-zinc-600">·</span>
        last {{ data.lapCount }} {{ data.lapCount === 1 ? 'lap' : 'laps' }}
      </span>
    </header>
    <div class="divide-y divide-zinc-800/60">
      <div
        v-for="row in rows"
        :key="row.label"
        class="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-1.5 text-sm tabular-nums"
      >
        <span class="text-zinc-400">{{ row.label }}</span>
        <span class="text-zinc-100">{{ row.value }}</span>
      </div>
    </div>
  </section>

  <section
    v-else-if="data && rows !== null && data.lapCount === 0"
    class="mb-10 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/20 p-4 font-mono text-xs text-zinc-500"
  >
    No recent laps for this build — drive a session to populate this panel.
  </section>
</template>
