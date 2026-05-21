<script setup lang="ts">
import {
  TUNE_SECTIONS,
  DEFAULT_OPEN_SECTIONS,
  SECTION_LABELS,
  tuneFieldsBySection,
  type TuneSettings
} from '~/utils/tune-fields'

const props = defineProps<{
  buildId: number
  /** Existing tune id, if editing. */
  existingTuneId?: number | null
  /** Initial settings (when editing). */
  initialTune?: TuneSettings | null
  /** Initial name. */
  initialName?: string | null
  /** Parent build's drivetrain — gates differential fields. */
  drivetrain?: string | null
}>()

const emit = defineEmits<{
  saved: [tune: { id: number, name: string }]
  cancel: []
}>()

const name = ref(props.initialName ?? '')
const values = reactive<Record<string, string | number | null>>({})

const sectionGroups = computed(() => tuneFieldsBySection(props.drivetrain))

// Initialise values from initialTune.
for (const sectionKey of TUNE_SECTIONS) {
  const fields = sectionGroups.value[sectionKey] ?? []
  for (const f of fields) {
    const seeded = props.initialTune?.[f.id as keyof TuneSettings]
    values[f.id] = (seeded !== undefined && seeded !== null && seeded !== '') ? seeded : null
  }
}

const openState = reactive<Record<string, boolean>>({ ...DEFAULT_OPEN_SECTIONS })

const saving = ref(false)
const error = ref<string | null>(null)

// --- "Copy from previous tune on this build" ----------------------------

interface TuneListEntry {
  id: number
  name: string
  createdAt: string
  sessionCount: number
}

const { data: previousTunes, refresh: refreshPrevious } = await useFetch<TuneListEntry[]>(
  `/api/builds/${props.buildId}/tunes`,
  { default: () => [] }
)

const copyFromId = ref<number | null>(null)

async function copyFromPrevious() {
  if (!copyFromId.value) return
  try {
    const t = await $fetch<{ name: string, settings: TuneSettings }>(`/api/tunes/${copyFromId.value}`)
    name.value = t.name + ' (copy)'
    for (const sectionKey of TUNE_SECTIONS) {
      const fields = sectionGroups.value[sectionKey] ?? []
      for (const f of fields) {
        const v = t.settings?.[f.id as keyof TuneSettings]
        if (v !== undefined) values[f.id] = v as string | number | null
      }
    }
  } catch (err) {
    const e = err as { message?: string }
    error.value = e.message ?? 'Failed to load tune'
  }
}

// --- Save ---------------------------------------------------------------

async function save() {
  if (saving.value) return
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    error.value = 'Name is required'
    return
  }

  saving.value = true
  error.value = null

  const settings: TuneSettings = {}
  for (const sectionKey of TUNE_SECTIONS) {
    const fields = sectionGroups.value[sectionKey] ?? []
    for (const f of fields) {
      const v = values[f.id]
      if (v === null || v === undefined || v === '') continue
      if (f.kind === 'number') {
        const n = Number(v)
        if (Number.isFinite(n)) settings[f.id as keyof TuneSettings] = n
      } else if (f.kind === 'text') {
        const s = String(v).trim()
        if (s) settings[f.id as keyof TuneSettings] = s
      } else {
        settings[f.id as keyof TuneSettings] = v
      }
    }
  }

  try {
    let tune: { id: number, name: string }
    if (props.existingTuneId) {
      tune = await $fetch<{ id: number, name: string }>(`/api/tunes/${props.existingTuneId}`, {
        method: 'PATCH',
        body: { name: trimmedName, settings }
      })
    } else {
      tune = await $fetch<{ id: number, name: string }>(`/api/builds/${props.buildId}/tunes`, {
        method: 'POST',
        body: { name: trimmedName, settings }
      })
    }
    await refreshPrevious()
    emit('saved', tune)
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    error.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'Save failed'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 font-mono">
    <header class="mb-4 flex items-baseline justify-between">
      <div class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        {{ existingTuneId ? 'Edit tune' : 'Add tune' }}
      </div>
      <button
        type="button"
        class="rounded-sm border border-transparent px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </header>

    <label class="mb-4 flex flex-col gap-1 text-sm">
      <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Tune name</span>
      <input
        v-model="name"
        type="text"
        placeholder="e.g. v1, mellow, stiffer rears"
        :disabled="saving"
        class="rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
      >
    </label>

    <div
      v-if="previousTunes && previousTunes.length"
      class="mb-4 flex items-center gap-2 text-sm"
    >
      <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Copy from</span>
      <select
        v-model="copyFromId"
        :disabled="saving"
        class="rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
      >
        <option :value="null">
          —
        </option>
        <option
          v-for="t in previousTunes"
          :key="t.id"
          :value="t.id"
        >
          {{ t.name }}
        </option>
      </select>
      <button
        type="button"
        :disabled="saving || !copyFromId"
        class="rounded-sm border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
        @click="copyFromPrevious"
      >
        Apply
      </button>
    </div>

    <div class="space-y-2">
      <details
        v-for="sectionKey in TUNE_SECTIONS"
        :key="sectionKey"
        :open="openState[sectionKey]"
        class="rounded-md border border-zinc-800/80 bg-zinc-950/30"
        @toggle="(e: Event) => { openState[sectionKey] = (e.target as HTMLDetailsElement).open }"
      >
        <summary class="cursor-pointer select-none px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-zinc-400 hover:text-zinc-200">
          {{ SECTION_LABELS[sectionKey] }}
          <span class="ml-2 text-zinc-600 normal-case tracking-normal">
            ({{ (sectionGroups[sectionKey] ?? []).length }} field{{ (sectionGroups[sectionKey] ?? []).length === 1 ? '' : 's' }})
          </span>
        </summary>
        <div class="grid grid-cols-1 gap-3 border-t border-zinc-800/80 p-3 sm:grid-cols-2">
          <label
            v-for="field in (sectionGroups[sectionKey] ?? [])"
            :key="field.id"
            class="flex flex-col gap-1 text-sm"
          >
            <span class="flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              <span>{{ field.label }}</span>
              <NuxtLink
                v-if="field.tuneRef"
                :to="`/tune/${field.tuneRef}`"
                class="text-zinc-600 normal-case tracking-normal hover:text-zinc-400"
                target="_blank"
              >
                ref →
              </NuxtLink>
            </span>
            <input
              v-model="values[field.id]"
              :type="field.kind === 'number' ? 'number' : 'text'"
              :step="field.kind === 'number' ? 'any' : undefined"
              :placeholder="field.unit ? field.unit.trim() : ''"
              :disabled="saving"
              class="rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
            >
          </label>
        </div>
      </details>
    </div>

    <div
      v-if="error"
      class="mt-3 rounded-sm border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300"
    >
      {{ error }}
    </div>

    <div class="mt-5 flex justify-end gap-2">
      <button
        type="button"
        :disabled="saving"
        class="rounded-sm border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500 disabled:opacity-50"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="button"
        :disabled="saving || !name.trim()"
        class="rounded-sm border border-green-500/60 bg-green-500/10 px-4 py-1.5 text-[11px] uppercase tracking-[0.2em] text-green-300 transition-colors hover:bg-green-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        @click="save"
      >
        {{ saving ? 'Saving…' : 'Save changes' }}
      </button>
    </div>
  </section>
</template>
