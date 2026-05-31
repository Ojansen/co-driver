<script setup lang="ts">
import {
  BUILD_FIELDS,
  type AutoSource,
  type BuildSettings,
  type SetupField,
  type UnitCategory
} from '~/utils/build-fields'

const { unitLabel, toDisplay, fromDisplay } = useUnits()

function displayValueFor(field: SetupField, canonical: string | number | null | undefined): string | number | null {
  if (canonical === null || canonical === undefined || canonical === '') return null
  if (!field.unitCategory) return canonical
  const n = Number(canonical)
  if (!Number.isFinite(n)) return canonical
  return toDisplay[field.unitCategory](n)
}

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
  /** Car ordinal — for the create/list endpoints. */
  carOrdinal: number
  /** Existing build id, if editing an existing build. */
  existingBuildId?: number | null
  /** Initial settings to pre-fill from (when editing). */
  initialBuild?: BuildSettings | null
  /** Initial name to pre-fill. */
  initialName?: string | null
  /** Auto-populate sources. */
  autoPower?: number | null
  autoPi?: number | null
  autoCarClass?: string | null
  autoDrivetrain?: string | null
}>()

const emit = defineEmits<{
  saved: [build: { id: number, name: string }]
  cancel: []
}>()

const AUTO_LABELS: Record<AutoSource, string> = {
  dyno_peak_power: 'from dyno',
  session_pi: 'from telemetry',
  car_class: 'from telemetry',
  car_drivetrain: 'from telemetry'
}

function autoValueFor(source: AutoSource | undefined): string | number | null {
  if (!source) return null
  switch (source) {
    case 'dyno_peak_power': return props.autoPower ?? null
    case 'session_pi': return props.autoPi ?? null
    case 'car_class': return props.autoCarClass ?? null
    case 'car_drivetrain': return props.autoDrivetrain ?? null
  }
}

// --- Form state -----------------------------------------------------------

const name = ref(props.initialName ?? '')
const values = reactive<Record<string, string | number | null>>({})

for (const f of BUILD_FIELDS) {
  const seeded = props.initialBuild?.[f.id as keyof BuildSettings]
  if (seeded !== undefined && seeded !== null && seeded !== '') {
    values[f.id] = seeded
  } else {
    values[f.id] = autoValueFor(f.auto)
  }
}

// Class follows PI: editing the PI field re-derives the class letter so the
// two stay consistent without manual bookkeeping. Stored/auto-seeded values
// are left untouched on open (non-immediate) — a manual class override only
// gets replaced once PI changes again. classFromPi never yields 'R', so an
// R-class pick is preserved until PI is edited.
watch(() => values.pi, (pi) => {
  const n = Number(pi)
  if (!Number.isFinite(n) || n <= 0) return
  const letter = classFromPi(n)
  if (letter !== '?') values.carClass = letter
})

const saving = ref(false)
const error = ref<string | null>(null)

// --- "Copy from previous build" ------------------------------------------

interface BuildListEntry {
  id: number
  name: string
  createdAt: string
}

const { data: previousBuilds, refresh: refreshPrevious } = await useFetch<BuildListEntry[]>(
  `/api/cars/${props.carOrdinal}/builds`,
  { default: () => [] }
)

const copyFromId = ref<number | null>(null)

const copyFromItems = computed(() => (previousBuilds.value ?? []).map(b => ({ label: b.name, value: b.id })))

// USelect's model rejects null — bridge null <-> undefined.
const copyFromModel = computed({
  get: () => copyFromId.value ?? undefined,
  set: (v: number | undefined) => { copyFromId.value = v ?? null }
})

/** Options for an enum field, with a leading "—" entry to clear the value. */
function enumItems(field: SetupField) {
  return [{ label: '—', value: '' }, ...(field.options ?? []).map(o => ({ label: o, value: o }))]
}

async function copyFromPrevious() {
  if (!copyFromId.value) return
  try {
    const build = await $fetch<{ name: string, settings: BuildSettings }>(`/api/builds/${copyFromId.value}`)
    name.value = build.name + ' (copy)'
    for (const f of BUILD_FIELDS) {
      const v = build.settings?.[f.id as keyof BuildSettings]
      if (v !== undefined) values[f.id] = v as string | number | null
    }
  } catch (err) {
    const e = err as { message?: string }
    error.value = e.message ?? 'Failed to load build'
  }
}

// --- Save -----------------------------------------------------------------

async function save() {
  if (saving.value) return
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    error.value = 'Name is required'
    return
  }

  saving.value = true
  error.value = null

  const settings: BuildSettings = {}
  for (const f of BUILD_FIELDS) {
    const v = values[f.id]
    if (v === null || v === undefined || v === '') continue
    if (f.kind === 'number') {
      const n = Number(v)
      if (Number.isFinite(n)) settings[f.id as keyof BuildSettings] = n
    } else if (f.kind === 'text') {
      const s = String(v).trim()
      if (s) settings[f.id as keyof BuildSettings] = s
    } else {
      settings[f.id as keyof BuildSettings] = v
    }
  }

  try {
    let build: { id: number, name: string }
    if (props.existingBuildId) {
      build = await $fetch<{ id: number, name: string }>(`/api/builds/${props.existingBuildId}`, {
        method: 'PATCH',
        body: { name: trimmedName, settings }
      })
    } else {
      build = await $fetch<{ id: number, name: string }>(`/api/cars/${props.carOrdinal}/builds`, {
        method: 'POST',
        body: { name: trimmedName, settings }
      })
    }
    await refreshPrevious()
    emit('saved', build)
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    error.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'Save failed'
  } finally {
    saving.value = false
  }
}

function autoHintFor(field: SetupField): string | null {
  if (!field.auto) return null
  const v = autoValueFor(field.auto)
  if (v === null || v === undefined) return null
  return AUTO_LABELS[field.auto]
}
</script>

<template>
  <section class="card p-4 font-mono">
    <header class="mb-4 flex items-baseline justify-between">
      <div class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        {{ existingBuildId ? 'Edit build' : 'Add build' }}
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
      <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Build name</span>
      <UInput
        v-model="name"
        placeholder="e.g. S2 race trim"
        :disabled="saving"
      />
    </label>

    <div
      v-if="previousBuilds && previousBuilds.length"
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

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label
        v-for="field in BUILD_FIELDS"
        :key="field.id"
        class="flex flex-col gap-1 text-sm"
      >
        <span class="flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          <span>{{ field.label }}</span>
          <span
            v-if="autoHintFor(field)"
            class="text-zinc-600 normal-case tracking-normal"
          >{{ autoHintFor(field) }}</span>
        </span>

        <USelect
          v-if="field.kind === 'enum'"
          :model-value="(values[field.id] ?? '') as string"
          :items="enumItems(field)"
          :disabled="saving"
          @update:model-value="(v) => values[field.id] = v === '' ? null : v"
        />

        <UInput
          v-else
          :model-value="String(displayValueFor(field, values[field.id]) ?? '')"
          :type="field.kind === 'number' ? 'number' : 'text'"
          :step="field.kind === 'number' ? 'any' : undefined"
          :placeholder="placeholderFor(field)"
          :disabled="saving"
          @update:model-value="(v) => values[field.id] = canonicalFromInput(field, String(v))"
        />
      </label>
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
