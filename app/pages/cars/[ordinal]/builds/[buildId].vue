<script setup lang="ts">
import type { BuildSettings } from '~/utils/build-fields'
import type { TuneSettings } from '~/utils/tune-fields'
import { EVENT_TYPE_LABELS, type EventType } from '~/utils/event-types'

const route = useRoute()

const ordinalParam = Number(route.params.ordinal)
const buildIdParam = Number(route.params.buildId)
if (!Number.isInteger(ordinalParam) || ordinalParam < 0
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

async function onBuildSaved() {
  editingBuild.value = false
  await refreshBuild()
}

// --- Tunes for this build --------------------------------------------------

interface TuneRow {
  id: number
  name: string
  settings: TuneSettings
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

const existingTuneNames = computed(() => tunes.value?.map(t => t.name) ?? [])

// --- Sessions that used this build ----------------------------------------

interface BuildSessionRow {
  sessionId: number
  eventId: number
  eventType: EventType
  eventName: string
  startedAt: string
  endedAt: string | null
  piAtStart: number
  tuneLabel: string | null
  lapCount: number
  bestLapMs: number | null
  bestLapId: number | null
}

const { data: sessions } = await useFetch<BuildSessionRow[]>(
  `/api/builds/${buildId}/sessions`,
  { default: () => [] }
)

const editingTuneId = ref<number | null>(null)

// Which tunes have their detail panel expanded (collapsed by default to keep
// the page compact).
const expandedTuneIds = ref<Set<number>>(new Set())
function toggleTuneDetails(id: number) {
  const next = new Set(expandedTuneIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedTuneIds.value = next
}

async function createTune(name: string) {
  const created = await $fetch<TuneRow>(`/api/builds/${buildId}/tunes`, {
    method: 'POST',
    body: { name, settings: {} }
  })
  await refreshTunes()
  // Open the new row immediately in edit mode for the user to fill in.
  editingTuneId.value = created.id
}

async function onTuneSaved() {
  editingTuneId.value = null
  await refreshTunes()
}

async function onBaselineCreated() {
  await refreshTunes()
}

// --- Tune delete -----------------------------------------------------------

function onTuneDeleted(tune: TuneRow) {
  if (editingTuneId.value === tune.id) editingTuneId.value = null
  return refreshTunes()
}
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader :title="build?.name ?? ''">
      <template #eyebrow>
        <NuxtLink
          to="/cars"
          class="hover:text-zinc-300"
        >
          Garage
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <NuxtLink
          :to="`/cars/${ordinal}`"
          class="hover:text-zinc-300"
        >
          {{ build?.carDisplayName ?? `#${ordinal}` }}
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <span class="text-zinc-300">{{ build?.name }}</span>
      </template>
      <template #meta>
        <span
          v-if="build"
          class="font-mono text-sm text-zinc-500"
        >[{{ classForDisplay(Number(build.settings.pi), build.carClass) }}] · {{ build.sessionCount }} session{{ build.sessionCount === 1 ? '' : 's' }}</span>
      </template>
    </PageHeader>

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

      <div
        v-if="build"
        class="mb-3"
      >
        <AutoTuneGenerator
          :build-id="buildId"
          :build="build.settings"
          :existing-names="existingTuneNames"
          @created="onBaselineCreated"
        />
      </div>

      <CreateForm
        class="mb-3"
        title="New tune"
        placeholder="e.g. v1, mellow, stiffer rears"
        :submit="createTune"
      />

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
              :initial-tune="tune.settings ?? {}"
              :initial-name="tune.name"
              :drivetrain="drivetrain"
              @saved="onTuneSaved"
              @cancel="editingTuneId = null"
            />
          </div>
          <div
            v-else
            class="card"
          >
            <div class="flex items-center justify-between gap-3 p-4">
              <div class="min-w-0 flex-1 font-mono">
                <div class="text-zinc-100">
                  {{ tune.name }}
                </div>
                <div class="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  {{ tune.sessionCount }} session{{ tune.sessionCount === 1 ? '' : 's' }} · created {{ relativeDate(tune.createdAt) }}
                </div>
              </div>
              <div class="flex shrink-0 gap-2">
                <button
                  type="button"
                  class="rounded-sm border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500"
                  @click="toggleTuneDetails(tune.id)"
                >
                  {{ expandedTuneIds.has(tune.id) ? 'Hide' : 'Details' }}
                </button>
                <button
                  type="button"
                  class="rounded-sm border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500"
                  @click="editingTuneId = tune.id"
                >
                  Edit
                </button>
                <DeleteAction
                  :url="`/api/tunes/${tune.id}`"
                  :title="`Delete tune “${tune.name}”?`"
                  confirm-label="Delete tune"
                  label="Delete"
                  size="xs"
                  @deleted="onTuneDeleted(tune)"
                >
                  <p>
                    Permanently remove this tune.
                    <span class="text-zinc-300">Cannot be undone.</span>
                  </p>
                  <ul class="mt-3 space-y-1 text-xs text-zinc-300">
                    <li v-if="tune.sessionCount > 0">
                      · {{ tune.sessionCount }} session{{ tune.sessionCount === 1 ? '' : 's' }} will be unlinked
                      <span class="text-zinc-500">(their tune snapshot stays — laps + compare still work)</span>
                    </li>
                    <li v-else>
                      · No sessions reference this tune.
                    </li>
                  </ul>
                </DeleteAction>
              </div>
            </div>
            <UCollapsible
              :open="expandedTuneIds.has(tune.id)"
              @update:open="toggleTuneDetails(tune.id)"
            >
              <template #content>
                <div class="border-t border-zinc-800/80 p-4">
                  <TuneDisplay
                    :tune="tune.settings ?? {}"
                    :drivetrain="drivetrain"
                    hide-edit
                  />
                </div>
              </template>
            </UCollapsible>
          </div>
        </li>
      </ul>
      <div
        v-else
        class="card-dashed p-6 text-center font-mono text-sm text-zinc-500"
      >
        No tunes for this build yet. Create one above.
      </div>
    </section>

    <section class="mb-4">
      <div class="mb-3 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        <span>Sessions using this build</span>
        <span class="text-zinc-600 normal-case tracking-normal">{{ sessions?.length ?? 0 }} total</span>
      </div>

      <ul
        v-if="sessions && sessions.length"
        class="space-y-2"
      >
        <li
          v-for="session in sessions"
          :key="session.sessionId"
        >
          <NuxtLink
            :to="`/events/${session.eventType}/${session.eventId}/${session.sessionId}`"
            class="group flex items-center justify-between gap-3 card p-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900/60"
          >
            <div class="min-w-0 font-mono">
              <div class="truncate text-zinc-100">
                {{ session.eventName }}
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                <span class="rounded-sm border border-zinc-800 px-1.5 py-0.5 text-zinc-400">
                  {{ EVENT_TYPE_LABELS[session.eventType] }}
                </span>
                <span>{{ session.lapCount }} lap{{ session.lapCount === 1 ? '' : 's' }}</span>
                <span class="text-zinc-700">·</span>
                <span>{{ relativeDate(session.startedAt) }}</span>
                <span class="text-zinc-700">·</span>
                <span>PI {{ session.piAtStart }}</span>
                <template v-if="session.tuneLabel">
                  <span class="text-zinc-700">·</span>
                  <span class="text-zinc-400 normal-case tracking-normal">{{ session.tuneLabel }}</span>
                </template>
              </div>
            </div>
            <div class="shrink-0 text-right font-mono">
              <div class="text-zinc-100">
                {{ session.bestLapMs != null ? formatLap(session.bestLapMs) : '—' }}
              </div>
              <div class="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-zinc-600 group-hover:text-zinc-400">
                best lap
              </div>
            </div>
          </NuxtLink>
        </li>
      </ul>
      <div
        v-else
        class="card-dashed p-6 text-center font-mono text-sm text-zinc-500"
      >
        No sessions yet. They appear here once you record a lap in Forza while
        driving this build.
      </div>
    </section>
  </main>
</template>
