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

const tuneItems = computed(() => (tunes.value ?? []).map(t => ({
  label: `${t.name} (${t.sessionCount} session${t.sessionCount === 1 ? '' : 's'})`,
  value: t.id
})))

// USelect's model rejects null — bridge null <-> undefined.
const selectedModel = computed({
  get: () => selected.value ?? undefined,
  set: (v: number | undefined) => { selected.value = v ?? null }
})

function attach() {
  if (!selected.value || props.disabled) return
  emit('attach', selected.value)
}
</script>

<template>
  <section class="card-dashed p-4 font-mono">
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
      <USelect
        v-model="selectedModel"
        :items="tuneItems"
        placeholder="— select a tune —"
        :disabled="disabled"
        class="flex-1 text-sm"
      />
      <UButton
        label="Attach"
        color="primary"
        variant="subtle"
        :disabled="disabled || !selected || selected === currentTuneId"
        class="font-mono text-[11px] uppercase tracking-[0.2em]"
        @click="attach"
      />
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
