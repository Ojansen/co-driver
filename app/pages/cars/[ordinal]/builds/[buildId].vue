<script setup lang="ts">
import type { BuildSettings } from '~/utils/build-fields'
import type { TuneSettings } from '~/utils/tune-fields'

const route = useRoute()

const ordinalParam = Number(route.params.ordinal)
const buildIdParam = Number(route.params.buildId)
if (!Number.isInteger(ordinalParam) || ordinalParam <= 0
  || !Number.isInteger(buildIdParam) || buildIdParam <= 0) {
  throw createError({ statusCode: 404, statusMessage: 'not found' })
}
const ordinal = ordinalParam
const buildId = buildIdParam

interface BuildDetail {
  id: number
  carId: number
  carOrdinal: number
  carClass: number
  carDisplayName: string | null
  name: string
  settings: BuildSettings
  createdAt: string
  tuneCount: number
  sessionCount: number
}

const { data: build, refresh: refreshBuild } = await useFetch<BuildDetail>(`/api/builds/${buildId}`)
if (!build.value) {
  throw createError({ statusCode: 404, statusMessage: 'build not found' })
}

useHead({ title: () => `${build.value?.name ?? 'Build'} · ${build.value?.carDisplayName ?? `#${ordinal}`}` })

const editingBuild = ref(false)

const CLASS_LETTERS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X', 'R']
function carClassLetter(c: number): string {
  return CLASS_LETTERS[c] ?? '?'
}

async function onBuildSaved() {
  editingBuild.value = false
  await refreshBuild()
}

// --- Tunes for this build --------------------------------------------------

interface TuneRow {
  id: number
  name: string
  createdAt: string
  sessionCount: number
}

const { data: tunes, refresh: refreshTunes } = await useFetch<TuneRow[]>(
  `/api/builds/${buildId}/tunes`,
  { default: () => [] }
)

const drivetrain = computed<string | null>(() => {
  const dt = build.value?.settings?.drivetrain
  return typeof dt === 'string' ? dt : null
})

const newTuneName = ref('')
const creating = ref(false)
const tuneCreateError = ref<string | null>(null)
const editingTuneId = ref<number | null>(null)
const expandedTuneId = ref<number | null>(null)
const tuneDetailCache = reactive<Record<number, { settings: TuneSettings, name: string }>>({})

async function createTune() {
  const trimmed = newTuneName.value.trim()
  if (!trimmed || creating.value) return
  creating.value = true
  tuneCreateError.value = null
  try {
    const created = await $fetch<TuneRow>(`/api/builds/${buildId}/tunes`, {
      method: 'POST',
      body: { name: trimmed, settings: {} }
    })
    newTuneName.value = ''
    await refreshTunes()
    // Open the new row immediately in edit mode for the user to fill in.
    editingTuneId.value = created.id
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    tuneCreateError.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'create failed'
  } finally {
    creating.value = false
  }
}

async function loadTuneDetail(id: number) {
  if (tuneDetailCache[id]) return
  try {
    const t = await $fetch<{ name: string, settings: TuneSettings }>(`/api/tunes/${id}`)
    tuneDetailCache[id] = { name: t.name, settings: t.settings ?? {} }
  } catch (err) {
    const e = err as { message?: string }
    tuneCreateError.value = e.message ?? 'Failed to load tune'
  }
}

async function startEdit(id: number) {
  await loadTuneDetail(id)
  editingTuneId.value = id
  expandedTuneId.value = null
}

async function toggleExpand(id: number) {
  if (expandedTuneId.value === id) {
    expandedTuneId.value = null
    return
  }
  await loadTuneDetail(id)
  expandedTuneId.value = id
}

async function onTuneSaved(saved: { id: number }) {
  editingTuneId.value = null
  // Invalidate cached detail so the next expand re-fetches.
  Reflect.deleteProperty(tuneDetailCache, saved.id)
  await refreshTunes()
}

function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.round(days / 30)}mo ago`
  return `${Math.round(days / 365)}y ago`
}
</script>

<template>
  <main class="mx-auto max-w-3xl px-6 py-10">
    <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <NuxtLink
        to="/cars"
        class="hover:text-zinc-300"
      >
        Garage
      </NuxtLink>
      <span class="mx-2 text-zinc-700">/</span>
      <NuxtLink
        :to="`/cars/${ordinal}`"
        class="hover:text-zinc-300"
      >
        {{ build?.carDisplayName ?? `#${ordinal}` }}
      </NuxtLink>
      <span class="mx-2 text-zinc-700">/</span>
      <span class="text-zinc-300">{{ build?.name }}</span>
    </div>

    <div class="mb-8 flex items-baseline gap-3">
      <h1 class="font-mono text-3xl text-zinc-100">
        {{ build?.name }}
      </h1>
      <span
        v-if="build"
        class="font-mono text-sm text-zinc-500"
      >[{{ carClassLetter(build.carClass) }}] · {{ build.sessionCount }} session{{ build.sessionCount === 1 ? '' : 's' }}</span>
    </div>

    <section class="mb-8">
      <BuildForm
        v-if="editingBuild && build"
        :car-ordinal="ordinal"
        :existing-build-id="buildId"
        :initial-build="build.settings"
        :initial-name="build.name"
        @saved="onBuildSaved"
        @cancel="editingBuild = false"
      />
      <BuildDisplay
        v-else-if="build"
        :build="build.settings"
        :build-name="build.name"
        @edit="editingBuild = true"
      />
    </section>

    <section class="mb-4">
      <div class="mb-3 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        <span>Tunes for this build</span>
        <span class="text-zinc-600 normal-case tracking-normal">{{ tunes?.length ?? 0 }} total</span>
      </div>

      <div class="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          New tune
        </div>
        <form
          class="flex gap-2"
          @submit.prevent="createTune"
        >
          <input
            v-model="newTuneName"
            type="text"
            placeholder="e.g. v1, mellow, stiffer rears"
            :disabled="creating"
            class="flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
          >
          <button
            type="submit"
            :disabled="creating || !newTuneName.trim()"
            class="rounded-sm border border-zinc-700 bg-zinc-900 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-green-500/60 hover:text-green-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ creating ? 'Creating…' : 'Create' }}
          </button>
        </form>
        <div
          v-if="tuneCreateError"
          class="mt-2 font-mono text-xs text-red-400"
        >
          {{ tuneCreateError }}
        </div>
      </div>

      <ul
        v-if="tunes && tunes.length"
        class="space-y-2"
      >
        <li
          v-for="tune in tunes"
          :key="tune.id"
        >
          <div
            v-if="editingTuneId === tune.id"
          >
            <TuneForm
              :build-id="buildId"
              :existing-tune-id="tune.id"
              :initial-tune="tuneDetailCache[tune.id]?.settings ?? {}"
              :initial-name="tuneDetailCache[tune.id]?.name ?? tune.name"
              :drivetrain="drivetrain"
              @saved="onTuneSaved"
              @cancel="editingTuneId = null"
            />
          </div>
          <div
            v-else
            class="rounded-lg border border-zinc-800 bg-zinc-900/40"
          >
            <div class="flex items-center justify-between gap-3 p-4">
              <button
                type="button"
                class="flex-1 text-left font-mono"
                @click="toggleExpand(tune.id)"
              >
                <div class="text-zinc-100">
                  {{ tune.name }}
                </div>
                <div class="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  {{ tune.sessionCount }} session{{ tune.sessionCount === 1 ? '' : 's' }} · created {{ relativeDate(tune.createdAt) }}
                </div>
              </button>
              <button
                type="button"
                class="rounded-sm border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500"
                @click="startEdit(tune.id)"
              >
                Edit
              </button>
            </div>
            <div
              v-if="expandedTuneId === tune.id && tuneDetailCache[tune.id]"
              class="border-t border-zinc-800/80 p-4"
            >
              <TuneDisplay
                :tune="tuneDetailCache[tune.id]!.settings"
                :tune-name="tuneDetailCache[tune.id]!.name"
                :drivetrain="drivetrain"
                hide-edit
              />
            </div>
          </div>
        </li>
      </ul>
      <div
        v-else
        class="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/20 p-6 text-center font-mono text-sm text-zinc-500"
      >
        No tunes for this build yet. Create one above.
      </div>
    </section>
  </main>
</template>
