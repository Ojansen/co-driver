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

const sectionGroups = computed(() => tuneFieldsBySection(props.drivetrain))

function filledCount(sectionKey: typeof TUNE_SECTIONS[number]): number {
  const fields = sectionGroups.value[sectionKey] ?? []
  let n = 0
  for (const f of fields) {
    const v = props.tune[f.id as keyof TuneSettings]
    if (v !== null && v !== undefined && v !== '') n++
  }
  return n
}
</script>

<template>
  <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 font-mono">
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

    <div class="space-y-2">
      <details
        v-for="sectionKey in TUNE_SECTIONS"
        :key="sectionKey"
        class="rounded-md border border-zinc-800/80 bg-zinc-950/30"
      >
        <summary class="cursor-pointer select-none px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-zinc-400 hover:text-zinc-200">
          {{ SECTION_LABELS[sectionKey] }}
          <span class="ml-2 text-zinc-600 normal-case tracking-normal">
            {{ filledCount(sectionKey) }} / {{ (sectionGroups[sectionKey] ?? []).length }} filled
          </span>
        </summary>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-zinc-800/80 p-3 text-sm sm:grid-cols-2">
          <div
            v-for="field in (sectionGroups[sectionKey] ?? [])"
            :key="field.id"
            class="flex items-baseline justify-between gap-3 border-b border-zinc-800/60 py-1"
          >
            <dt class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {{ field.label }}
            </dt>
            <dd class="tabular-nums text-zinc-200">
              {{ formatFieldValue(field, tune[field.id as keyof TuneSettings] ?? null) }}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  </section>
</template>
