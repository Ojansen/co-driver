<script setup lang="ts">
import { formatFieldValue } from '~/utils/build-fields'
import {
  TUNE_SECTIONS,
  SECTION_LABELS,
  tuneFieldsBySection,
  type TuneSettings
} from '~/utils/tune-fields'

const props = defineProps<{
  tune: TuneSettings
  tuneName?: string | null
  drivetrain?: string | null
  /** Hide the edit button (e.g. on session-detail where edit routes elsewhere). */
  hideEdit?: boolean
}>()

const emit = defineEmits<{
  edit: []
}>()

const { format } = useUnits()
const unitFmt = {
  pressure: format.pressure,
  springRate: format.springRate,
  distanceShort: format.distanceShort,
  downforce: format.downforce,
  powerHp: format.powerHp,
  mass: format.mass
}

const sectionGroups = computed(() => tuneFieldsBySection(props.drivetrain))
</script>

<template>
  <section class="card p-4 font-mono">
    <header class="mb-3 flex items-baseline justify-between">
      <div class="flex items-baseline gap-3 text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        <span>Tune</span>
        <span
          v-if="tuneName"
          class="normal-case tracking-normal text-zinc-300"
        >{{ tuneName }}</span>
      </div>
      <button
        v-if="!hideEdit"
        type="button"
        class="rounded-sm border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500"
        @click="emit('edit')"
      >
        Edit
      </button>
    </header>

    <div class="space-y-5">
      <div
        v-for="sectionKey in TUNE_SECTIONS"
        :key="sectionKey"
      >
        <h3 class="mb-2 border-b border-zinc-800/80 pb-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
          {{ SECTION_LABELS[sectionKey] }}
        </h3>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <div
            v-for="field in (sectionGroups[sectionKey] ?? [])"
            :key="field.id"
            class="flex items-baseline justify-between gap-3 border-b border-zinc-800/60 py-1"
          >
            <dt class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {{ field.label }}
            </dt>
            <dd class="tabular-nums text-zinc-200">
              {{ formatFieldValue(field, tune[field.id as keyof TuneSettings] ?? null, unitFmt) }}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>
