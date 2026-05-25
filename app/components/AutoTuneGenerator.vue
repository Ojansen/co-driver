<script setup lang="ts">
import {
  computeAutoTune,
  autoTuneSlug,
  STIFFNESS_OPTIONS,
  BALANCE_OPTIONS,
  SURFACE_OPTIONS,
  type Stiffness,
  type Balance,
  type Surface
} from '~/utils/auto-tune'
import type { BuildSettings } from '~/utils/build-fields'

const props = defineProps<{
  buildId: number
  build: BuildSettings
  /** Names of existing tunes on this build — used to auto-suffix the
   *  generated name so a second Generate with the same dials doesn't 409. */
  existingNames?: string[]
}>()

/** Return `base` if not taken, else `base-1`, `base-2`, ... whichever is free. */
function nextFreeName(base: string, taken: readonly string[]): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!set.has(candidate)) return candidate
  }
  // Safety fallback — extremely unlikely.
  return `${base}-${Date.now()}`
}

const emit = defineEmits<{
  (e: 'created', tune: { id: number, name: string }): void
}>()

const stiffness = ref<Stiffness>('medium')
const balance = ref<Balance>('neutral')
const surface = ref<Surface>('road')

const STIFFNESS_LABELS: Record<Stiffness, string> = {
  soft: 'Soft',
  medium: 'Medium',
  stiff: 'Stiff'
}
const BALANCE_LABELS: Record<Balance, string> = {
  loose: 'Loose (oversteer-leaning)',
  neutral: 'Neutral',
  tight: 'Tight (understeer-leaning)'
}
const SURFACE_LABELS: Record<Surface, string> = {
  'road': 'Road',
  'dirt': 'Dirt',
  'cross-country': 'Cross-country'
}

const preview = computed(() => computeAutoTune({
  build: props.build,
  dials: { stiffness: stiffness.value, balance: balance.value, surface: surface.value }
}))

const blocked = computed(() => preview.value.blockers.length > 0)

function autoNameFor(dials: { stiffness: Stiffness, balance: Balance, surface: Surface }): string {
  return nextFreeName(autoTuneSlug(dials), props.existingNames ?? [])
}

const name = ref(autoNameFor({ stiffness: stiffness.value, balance: balance.value, surface: surface.value }))

// Refresh the name when the dials change *or* when a new tune is added to
// the build (which mutates props.existingNames). Only auto-refresh while the
// name still looks like an auto slug — if the user typed their own name,
// leave it alone.
watch(
  [stiffness, balance, surface, () => props.existingNames],
  ([s, b, su]) => {
    if (!name.value.startsWith('baseline-')) return
    name.value = autoNameFor({ stiffness: s, balance: b, surface: su })
  }
)

const generating = ref(false)
const error = ref<string | null>(null)

async function generate() {
  const trimmed = name.value.trim()
  if (!trimmed || generating.value || blocked.value) return
  generating.value = true
  error.value = null
  // Re-check against the live existing-names list at submit time, in case the
  // parent fetched new tunes after the input value was last computed.
  const finalName = nextFreeName(trimmed, props.existingNames ?? [])
  try {
    const created = await $fetch<{ id: number, name: string }>(`/api/builds/${props.buildId}/tunes`, {
      method: 'POST',
      body: { name: finalName, settings: preview.value.tune }
    })
    emit('created', created)
    // Reset to the next free auto-name (parent will refresh existingNames
    // shortly, which will also re-trigger the watcher).
    name.value = autoNameFor({ stiffness: stiffness.value, balance: balance.value, surface: surface.value })
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    error.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'Generate failed'
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <section class="card p-4 font-mono">
    <header class="mb-3 flex items-baseline justify-between">
      <div class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        Auto baseline tune
      </div>
      <span class="text-[10px] text-zinc-600 normal-case tracking-normal">starting point · refine via /tune</span>
    </header>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label class="flex flex-col gap-1 text-sm">
        <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Stiffness</span>
        <select
          v-model="stiffness"
          :disabled="generating"
          class="rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
        >
          <option
            v-for="o in STIFFNESS_OPTIONS"
            :key="o"
            :value="o"
          >
            {{ STIFFNESS_LABELS[o] }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Balance</span>
        <select
          v-model="balance"
          :disabled="generating"
          class="rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
        >
          <option
            v-for="o in BALANCE_OPTIONS"
            :key="o"
            :value="o"
          >
            {{ BALANCE_LABELS[o] }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Surface</span>
        <select
          v-model="surface"
          :disabled="generating"
          class="rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
        >
          <option
            v-for="o in SURFACE_OPTIONS"
            :key="o"
            :value="o"
          >
            {{ SURFACE_LABELS[o] }}
          </option>
        </select>
      </label>
    </div>

    <div
      v-if="preview.blockers.length"
      class="mt-3 rounded-sm border border-red-700/50 bg-red-950/30 px-3 py-2 text-[11px] text-red-300"
    >
      <div class="mb-1 text-[10px] uppercase tracking-[0.2em] text-red-400/70">
        Build incomplete — fill these to generate
      </div>
      <ul class="space-y-0.5">
        <li
          v-for="(b, i) in preview.blockers"
          :key="i"
        >
          • {{ b }}
        </li>
      </ul>
    </div>

    <div
      v-else-if="preview.warnings.length"
      class="mt-3 rounded-sm border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-300"
    >
      <div class="mb-1 text-[10px] uppercase tracking-[0.2em] text-amber-400/70">
        Partial output
      </div>
      <ul class="space-y-0.5">
        <li
          v-for="(w, i) in preview.warnings"
          :key="i"
        >
          {{ w }}
        </li>
      </ul>
    </div>

    <form
      class="mt-3 flex gap-2"
      @submit.prevent="generate"
    >
      <input
        v-model="name"
        type="text"
        :disabled="generating || blocked"
        class="flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
      >
      <button
        type="submit"
        :disabled="generating || blocked || !name.trim()"
        class="rounded-sm border border-zinc-700 bg-zinc-900 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-green-500/60 hover:text-green-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ generating ? 'Generating…' : 'Generate' }}
      </button>
    </form>
    <div
      v-if="error"
      class="mt-2 text-xs text-red-400"
    >
      {{ error }}
    </div>
  </section>
</template>
