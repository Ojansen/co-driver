<script setup lang="ts">
import { downloadUrl } from '~/utils/download'
import { formatLap, relativeDate } from '~/utils/format'
import { carClassLetter } from '~/utils/class'
import { EVENT_TYPE_LABELS, type EventType } from '~/utils/event-types'
import { apiErrorMessage } from '~/utils/api-error'

useHead({ title: 'Transfer · co-driver' })

interface LapRow { id: number, lapNumber: number, timeMs: number }
interface SessionRow {
  sessionId: number
  carId: number
  carOrdinal: number
  carClass: number
  carDisplayName: string | null
  eventId: number
  eventName: string
  eventType: EventType | null
  tuneLabel: string | null
  piAtStart: number
  startedAt: string | number
  endedAt: string | number | null
  laps: LapRow[]
}
interface ImportResult {
  lapId: number
  sessionId: number
  eventId: number
  eventType: EventType | null
  alreadyPresent: boolean
}

// Scope to the active game (workspace): only that sim's recordings show here.
const { gameId } = useGame()
const { data: sessions, refresh } = await useFetch<SessionRow[]>('/api/sessions', {
  query: { gameId },
  default: () => []
})

const grouped = computed(() => {
  const map = new Map<number, { carId: number, label: string, klass: string, sessions: SessionRow[] }>()
  for (const s of sessions.value ?? []) {
    let g = map.get(s.carId)
    if (!g) {
      g = {
        carId: s.carId,
        label: s.carDisplayName ?? `Car #${s.carOrdinal}`,
        klass: carClassLetter(s.carClass),
        sessions: []
      }
      map.set(s.carId, g)
    }
    g.sessions.push(s)
  }
  return [...map.values()]
})

const EXPORT_FORMATS = [
  { fmt: 'csv', label: 'CSV', hint: 'generic' },
  { fmt: 'json', label: 'JSON', hint: 'raw' },
  { fmt: 'ld', label: 'MoTeC', hint: 'i2 binary' },
  { fmt: 'bundle', label: 'Bundle', hint: 'co-driver' }
] as const

const expanded = ref(new Set<number>())
function toggle(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

const fileInput = ref<HTMLInputElement>()
const importing = ref(false)
const importErr = ref('')
const imported = ref<ImportResult | null>(null)

function pickFile() {
  importErr.value = ''
  imported.value = null
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // let the same file be re-picked
  if (!file) return

  importing.value = true
  importErr.value = ''
  imported.value = null
  try {
    let body: Record<string, unknown>
    try {
      body = JSON.parse(await file.text()) as Record<string, unknown>
    } catch {
      throw createError({ statusMessage: 'file is not valid JSON' })
    }
    imported.value = await $fetch<ImportResult>('/api/laps/import', { method: 'POST', body })
    await refresh()
  } catch (err) {
    importErr.value = apiErrorMessage(err, 'import failed')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <main class="container mx-auto max-w-5xl px-6 py-10">
    <PageHeader title="Transfer">
      <template #eyebrow>
        Import &amp; export
      </template>
      <template #intro>
        Export any lap for a dedicated analysis tool (MoTeC i2, Excel,
        Python) or to share with another co-driver. Imported co-driver bundles
        merge into your garage by identity — nothing is duplicated.
      </template>
      <template #actions>
        <UButton
          icon="i-lucide-upload"
          color="primary"
          variant="subtle"
          size="sm"
          :loading="importing"
          label="Import lap"
          @click="pickFile"
        />
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="onFile"
        >
      </template>
    </PageHeader>

    <div
      v-if="imported"
      class="card mb-6 border-green-500/40 bg-green-500/5 p-4 font-mono text-sm text-green-200"
    >
      <span v-if="imported.alreadyPresent">Lap already present — nothing imported. </span>
      <span v-else>Lap imported. </span>
      <NuxtLink
        :to="`/events/${imported.eventId}/${imported.sessionId}`"
        class="underline hover:text-green-100"
      >
        Open session →
      </NuxtLink>
    </div>
    <p
      v-if="importErr"
      class="card mb-6 border-red-500/40 bg-red-500/5 p-4 font-mono text-sm text-red-300"
    >
      {{ importErr }}
    </p>

    <div
      v-if="grouped.length === 0"
      class="card-dashed p-8 text-center font-mono text-sm text-zinc-500"
    >
      No sessions recorded yet. Drive a lap, then come back to export it.
    </div>

    <section
      v-for="car in grouped"
      :key="car.carId"
      class="mb-8"
    >
      <div class="mb-3 flex items-baseline gap-3">
        <h2 class="font-mono text-xl text-zinc-100">
          {{ car.label }}
        </h2>
        <span class="rounded-sm bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
          {{ car.klass }}
        </span>
        <span class="font-mono text-[11px] text-zinc-500">
          {{ car.sessions.length }} session{{ car.sessions.length === 1 ? '' : 's' }}
        </span>
      </div>

      <div class="card divide-y divide-zinc-800/60 p-0">
        <div
          v-for="s in car.sessions"
          :key="s.sessionId"
        >
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-900/60"
            @click="toggle(s.sessionId)"
          >
            <UIcon
              :name="expanded.has(s.sessionId) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-4 shrink-0 text-zinc-500"
            />
            <span class="min-w-0 flex-1 truncate font-mono text-sm text-zinc-200">
              <template v-if="s.eventType">{{ EVENT_TYPE_LABELS[s.eventType] }} · </template>{{ s.eventName }}
              <span
                v-if="s.tuneLabel"
                class="text-zinc-500"
              >— {{ s.tuneLabel }}</span>
            </span>
            <span class="shrink-0 font-mono text-[11px] text-zinc-500 tabular-nums">
              PI {{ s.piAtStart }}
            </span>
            <span class="shrink-0 font-mono text-[11px] text-zinc-500">
              {{ relativeDate(typeof s.startedAt === 'string' ? s.startedAt : null) }}
            </span>
            <span class="shrink-0 font-mono text-[11px] text-zinc-400 tabular-nums">
              {{ s.laps.length }} lap{{ s.laps.length === 1 ? '' : 's' }}
            </span>
          </button>

          <div
            v-if="expanded.has(s.sessionId)"
            class="border-t border-zinc-800/60 bg-zinc-950/40 px-4 py-2"
          >
            <p
              v-if="s.laps.length === 0"
              class="py-2 font-mono text-xs text-zinc-600"
            >
              No laps in this session.
            </p>
            <div
              v-for="lap in s.laps"
              :key="lap.id"
              class="flex flex-wrap items-center gap-x-4 gap-y-2 py-2"
            >
              <span class="w-16 shrink-0 font-mono text-xs text-zinc-400">
                Lap {{ lap.lapNumber }}
              </span>
              <span class="w-24 shrink-0 font-mono text-xs text-zinc-200 tabular-nums">
                {{ formatLap(lap.timeMs) }}
              </span>
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  v-for="f in EXPORT_FORMATS"
                  :key="f.fmt"
                  type="button"
                  class="rounded-sm border border-zinc-700 bg-zinc-900 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-300 transition-colors hover:border-green-500/60 hover:text-green-300"
                  :title="`Export lap ${lap.lapNumber} as ${f.label} (${f.hint})`"
                  @click="downloadUrl(`/api/laps/${lap.id}/export?format=${f.fmt}`)"
                >
                  {{ f.label }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>
