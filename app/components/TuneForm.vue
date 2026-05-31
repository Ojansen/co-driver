<script setup lang="ts">
import {
  TUNE_SECTIONS,
  DEFAULT_OPEN_SECTIONS,
  SECTION_LABELS,
  tuneFieldsBySection,
  type TuneField,
  type TuneSettings
} from '~/utils/tune-fields'
import type { SetupField, UnitCategory } from '~/utils/build-fields'

const { unitLabel, toDisplay, fromDisplay } = useUnits()

/** Convert stored canonical value → displayed value (string for input v-bind).
 *  For fields without unitCategory, the canonical value is the display value. */
function displayValueFor(field: SetupField, canonical: string | number | null | undefined): string | number | null {
  if (canonical === null || canonical === undefined || canonical === '') return null
  if (!field.unitCategory) return canonical
  const n = Number(canonical)
  if (!Number.isFinite(n)) return canonical
  return toDisplay[field.unitCategory](n)
}

/** Inverse: take the raw input string and return what should be written to
 *  the canonical `values` map. Empty string / non-numeric clears to null. */
function canonicalFromInput(field: SetupField, raw: string): string | number | null {
  if (raw === '') return null
  if (field.kind === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    if (field.unitCategory) return fromDisplay[field.unitCategory](n)
    return n
  }
  return raw
}

/** Canonical → display conversion for a numeric bound. For unit-category
 *  fields, runs through the active unit pref; for plain numeric fields, the
 *  bound is already in display units. */
function toDisplayNumber(field: TuneField, canonical: number): number {
  if (!field.unitCategory) return canonical
  return toDisplay[field.unitCategory](canonical)
}

/** Min / max / step for the HTML5 number input, converted to the display
 *  unit. Returned values are strings (matching the attribute typing) — empty
 *  string means "no constraint." */
function inputBoundsFor(field: TuneField): { min: string, max: string, step: string } {
  if (field.kind !== 'number') return { min: '', max: '', step: 'any' }
  const min = field.min !== undefined ? String(toDisplayNumber(field, field.min)) : ''
  const max = field.max !== undefined ? String(toDisplayNumber(field, field.max)) : ''
  // Step is a delta — convert it the same way as a value-from-zero. Linear
  // conversions (all of ours) make this exact; we round to 4dp to drop
  // floating-point fuzz like 0.1 bar → 0.100000000001.
  let step: string = 'any'
  if (field.step !== undefined) {
    const s = field.unitCategory
      ? Number((toDisplay[field.unitCategory](field.step) - toDisplay[field.unitCategory](0)).toFixed(4))
      : field.step
    step = String(s)
  }
  return { min, max, step }
}

/** True if the stored canonical value falls outside the field's FH6 range.
 *  Returns false when the field has no bounds or the value is empty. */
function isOutOfRange(field: TuneField, canonical: string | number | null | undefined): boolean {
  if (canonical === null || canonical === undefined || canonical === '') return false
  if (field.min === undefined && field.max === undefined) return false
  const n = Number(canonical)
  if (!Number.isFinite(n)) return false
  if (field.min !== undefined && n < field.min) return true
  if (field.max !== undefined && n > field.max) return true
  return false
}

/** Human-readable bounds string for the warning ("FH6 range: 1.0 – 20.0"). */
function rangeLabelFor(field: TuneField): string {
  if (field.min === undefined && field.max === undefined) return ''
  const lo = field.min !== undefined ? String(toDisplayNumber(field, field.min)) : '−∞'
  const hi = field.max !== undefined ? String(toDisplayNumber(field, field.max)) : '∞'
  return `FH6 range: ${lo} – ${hi}`
}

/** Suffix the input placeholder hints at — uses live unit-pref labels for
 *  switchable fields; falls back to the static `field.unit`. */
function placeholderFor(field: SetupField): string {
  if (field.unitCategory) {
    const map: Record<UnitCategory, string> = {
      pressure: unitLabel.pressure,
      springRate: unitLabel.springRate,
      distanceShortIn: unitLabel.distanceShort,
      downforce: unitLabel.downforce,
      powerHp: unitLabel.power,
      mass: unitLabel.mass
    }
    return map[field.unitCategory]
  }
  return field.unit ? field.unit.trim() : ''
}

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

const copyFromItems = computed(() => (previousTunes.value ?? []).map(t => ({ label: t.name, value: t.id })))

// USelect's model rejects null — bridge null <-> undefined.
const copyFromModel = computed({
  get: () => copyFromId.value ?? undefined,
  set: (v: number | undefined) => { copyFromId.value = v ?? null }
})

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
  <section class="card p-4 font-mono">
    <header class="mb-4 flex items-baseline justify-between">
      <div class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        {{ existingTuneId ? 'Edit tune' : 'Add tune' }}
      </div>
      <UButton
        label="Cancel"
        color="neutral"
        variant="ghost"
        size="xs"
        class="font-mono text-[10px] uppercase tracking-[0.2em]"
        @click="emit('cancel')"
      />
    </header>

    <label class="mb-4 flex flex-col gap-1 text-sm">
      <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Tune name</span>
      <UInput
        v-model="name"
        placeholder="e.g. v1, mellow, stiffer rears"
        :disabled="saving"
      />
    </label>

    <div
      v-if="previousTunes && previousTunes.length"
      class="mb-4 flex items-center gap-2 text-sm"
    >
      <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Copy from</span>
      <USelect
        v-model="copyFromModel"
        :items="copyFromItems"
        placeholder="—"
        :disabled="saving"
        size="xs"
        class="text-xs"
      />
      <UButton
        label="Apply"
        color="neutral"
        variant="outline"
        size="xs"
        :disabled="saving || !copyFromId"
        class="font-mono text-[10px] uppercase tracking-[0.2em]"
        @click="copyFromPrevious"
      />
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
            <UInput
              :model-value="String(displayValueFor(field, values[field.id]) ?? '')"
              :type="field.kind === 'number' ? 'number' : 'text'"
              :min="field.kind === 'number' ? inputBoundsFor(field).min : undefined"
              :max="field.kind === 'number' ? inputBoundsFor(field).max : undefined"
              :step="field.kind === 'number' ? inputBoundsFor(field).step : undefined"
              :placeholder="placeholderFor(field)"
              :disabled="saving"
              :color="isOutOfRange(field, values[field.id]) ? 'warning' : 'neutral'"
              :highlight="isOutOfRange(field, values[field.id])"
              @update:model-value="(v) => values[field.id] = canonicalFromInput(field, String(v))"
            />
            <span
              v-if="isOutOfRange(field, values[field.id])"
              class="text-[10px] normal-case tracking-normal text-amber-400/80"
            >
              ⚠ {{ rangeLabelFor(field) }}
            </span>
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
      <UButton
        label="Cancel"
        color="neutral"
        variant="outline"
        :disabled="saving"
        class="font-mono text-[11px] uppercase tracking-[0.2em]"
        @click="emit('cancel')"
      />
      <UButton
        label="Save changes"
        color="primary"
        variant="subtle"
        :loading="saving"
        :disabled="saving || !name.trim()"
        class="font-mono text-[11px] uppercase tracking-[0.2em]"
        @click="save"
      />
    </div>
  </section>
</template>
