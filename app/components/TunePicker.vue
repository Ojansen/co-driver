<script setup lang="ts">
const props = defineProps<{
  /** Build the picker filters to. */
  buildId: number
  /** Car ordinal — used for the "Create new tune" link target. */
  carOrdinal: number
  /** Current attached tune id, if any. */
  currentTuneId?: number | null
  /** Disable while parent is saving. */
  disabled?: boolean
}>()

const emit = defineEmits<{
  attach: [tuneId: number]
}>()

interface TuneListEntry {
  id: number
  name: string
  createdAt: string
  sessionCount: number
}

const { data: tunes, pending } = await useFetch<TuneListEntry[]>(
  () => `/api/builds/${props.buildId}/tunes`,
  { default: () => [] }
)

const selected = ref<number | null>(props.currentTuneId ?? null)

watch(() => props.currentTuneId, (v) => {
  selected.value = v ?? null
})

function attach() {
  if (!selected.value || props.disabled) return
  emit('attach', selected.value)
}
</script>

<template>
  <section class="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/20 p-4 font-mono">
    <div class="mb-3 flex items-baseline justify-between text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <span>Attach a tune</span>
      <NuxtLink
        :to="`/cars/${carOrdinal}/builds/${buildId}`"
        class="normal-case tracking-normal text-green-400 transition-colors hover:text-green-300"
      >
        + Create or edit tunes for this build →
      </NuxtLink>
    </div>

    <div
      v-if="pending"
      class="text-sm text-zinc-500"
    >
      Loading tunes…
    </div>
    <div
      v-else-if="tunes && tunes.length"
      class="flex items-center gap-2"
    >
      <select
        v-model="selected"
        :disabled="disabled"
        class="flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
      >
        <option :value="null">
          — select a tune —
        </option>
        <option
          v-for="t in tunes"
          :key="t.id"
          :value="t.id"
        >
          {{ t.name }} ({{ t.sessionCount }} session{{ t.sessionCount === 1 ? '' : 's' }})
        </option>
      </select>
      <button
        type="button"
        :disabled="disabled || !selected || selected === currentTuneId"
        class="rounded-sm border border-green-500/60 bg-green-500/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-green-300 transition-colors hover:bg-green-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        @click="attach"
      >
        Attach
      </button>
    </div>
    <div
      v-else
      class="text-sm text-zinc-400"
    >
      No tunes saved for this build yet.
      <NuxtLink
        :to="`/cars/${carOrdinal}/builds/${buildId}`"
        class="text-green-400 transition-colors hover:text-green-300"
      >
        Create one on the build page →
      </NuxtLink>
    </div>
  </section>
</template>
