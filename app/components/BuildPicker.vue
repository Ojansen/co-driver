<script setup lang="ts">
const props = defineProps<{
  carOrdinal: number
  /** Current attached build (if any) — to highlight in the picker. */
  currentBuildId?: number | null
  /** Disable interaction (e.g. while parent is saving). */
  disabled?: boolean
}>()

const emit = defineEmits<{
  attach: [buildId: number]
}>()

interface BuildListEntry {
  id: number
  name: string
  createdAt: string
  tuneCount: number
  sessionCount: number
}

const { data: builds, pending } = await useFetch<BuildListEntry[]>(
  () => `/api/cars/${props.carOrdinal}/builds`,
  { default: () => [] }
)

const selected = ref<number | null>(props.currentBuildId ?? null)
const error = ref<string | null>(null)

watch(() => props.currentBuildId, (v) => {
  selected.value = v ?? null
})

const buildItems = computed(() => (builds.value ?? []).map(b => ({
  label: `${b.name} (${b.sessionCount} session${b.sessionCount === 1 ? '' : 's'})`,
  value: b.id
})))

// USelect's model rejects null — bridge null <-> undefined.
const selectedModel = computed({
  get: () => selected.value ?? undefined,
  set: (v: number | undefined) => { selected.value = v ?? null }
})

async function attachSelected() {
  if (!selected.value || props.disabled) return
  error.value = null
  emit('attach', selected.value)
}
</script>

<template>
  <section class="card-dashed p-4 font-mono">
    <div class="mb-3 flex items-baseline justify-between text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <span>Attach a build</span>
      <NuxtLink
        :to="`/cars/${carOrdinal}`"
        class="normal-case tracking-normal text-green-400 transition-colors hover:text-green-300"
      >
        + Create or edit builds in the garage →
      </NuxtLink>
    </div>

    <div
      v-if="pending"
      class="text-sm text-zinc-500"
    >
      Loading builds…
    </div>
    <div
      v-else-if="builds && builds.length"
      class="flex items-center gap-2"
    >
      <USelect
        v-model="selectedModel"
        :items="buildItems"
        placeholder="— select a build —"
        :disabled="disabled"
        class="flex-1 text-sm"
      />
      <UButton
        label="Attach"
        color="primary"
        variant="subtle"
        :disabled="disabled || !selected || selected === currentBuildId"
        class="font-mono text-[11px] uppercase tracking-[0.2em]"
        @click="attachSelected"
      />
    </div>
    <div
      v-else
      class="text-sm text-zinc-400"
    >
      No builds saved for this car yet.
      <NuxtLink
        :to="`/cars/${carOrdinal}`"
        class="text-green-400 transition-colors hover:text-green-300"
      >
        Create one in the garage →
      </NuxtLink>
    </div>

    <div
      v-if="error"
      class="mt-3 rounded-sm border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300"
    >
      {{ error }}
    </div>
  </section>
</template>
