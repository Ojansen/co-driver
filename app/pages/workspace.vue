<script setup lang="ts">
import { carClassLetter } from '~/utils/class'
import { formatLap, relativeDate } from '~/utils/format'
import { EVENT_TYPE_LABELS, type EventType } from '~/utils/event-types'

// Per-game workspace home: the game's cars used → track sessions, the natural
// unit for analysing sim racing (car + track → laps vs a reference). Reuses the
// game-scoped /api/sessions endpoint and links into the existing replay/compare
// pages — it's the overview that sits above them.
const { gameId, game } = useGame()

useHead({ title: () => `${game.value.label} · co-driver` })

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
  startedAt: string | number
  laps: LapRow[]
}

const { data: sessions } = await useFetch<SessionRow[]>('/api/sessions', {
  query: { gameId },
  default: () => []
})

// compare.vue overlays a handful of laps at once; cap the deep-link so it stays
// legible (fastest first, the best lap as the reference baseline).
const MAX_COMPARE_LAPS = 6

interface TrackAgg {
  eventId: number
  eventName: string
  eventType: EventType | null
  sessionCount: number
  laps: LapRow[]
  lastAt: string | null
}

const cars = computed(() => {
  const carMap = new Map<number, { carId: number, label: string, klass: string, tracks: Map<number, TrackAgg> }>()
  for (const s of sessions.value ?? []) {
    let c = carMap.get(s.carId)
    if (!c) {
      c = {
        carId: s.carId,
        label: s.carDisplayName ?? `Car #${s.carOrdinal}`,
        klass: carClassLetter(s.carClass),
        tracks: new Map()
      }
      carMap.set(s.carId, c)
    }
    let tr = c.tracks.get(s.eventId)
    if (!tr) {
      tr = { eventId: s.eventId, eventName: s.eventName, eventType: s.eventType, sessionCount: 0, laps: [], lastAt: null }
      c.tracks.set(s.eventId, tr)
    }
    tr.sessionCount++
    for (const lap of s.laps) if (lap.timeMs > 0) tr.laps.push(lap)
    const at = typeof s.startedAt === 'string' ? s.startedAt : null
    if (at && (!tr.lastAt || at > tr.lastAt)) tr.lastAt = at
  }

  return [...carMap.values()].map(c => ({
    carId: c.carId,
    label: c.label,
    klass: c.klass,
    tracks: [...c.tracks.values()].map((tr) => {
      const sorted = [...tr.laps].sort((a, b) => a.timeMs - b.timeMs)
      const best = sorted[0] ?? null
      const top = sorted.slice(0, MAX_COMPARE_LAPS)
      // Reference-lap comparison: link to the existing overlay page preloaded
      // with the fastest laps, best lap as the Δ baseline. Needs ≥2 laps.
      const compareHref = best && top.length >= 2
        ? `/events/${tr.eventId}/compare?laps=${top.map(l => l.id).join(',')}&ref=${best.id}`
        : null
      return {
        ...tr,
        lapCount: tr.laps.length,
        best,
        compareHref,
        openHref: `/events/${tr.eventId}`
      }
    }).sort((a, b) => (a.best?.timeMs ?? Infinity) - (b.best?.timeMs ?? Infinity))
  }))
})
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader :title="game.label">
      <template #eyebrow>
        <NuxtLink
          to="/"
          class="hover:text-zinc-300"
        >
          Workspaces
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <span class="text-zinc-300">{{ game.label }}</span>
      </template>
      <template #intro>
        Your cars and the tracks you've run in {{ game.label }}. Pick a car + track
        to compare laps against a reference, or jump straight into a live session.
      </template>
      <template #actions>
        <UButton
          to="/live"
          icon="i-lucide-radio"
          color="primary"
          variant="subtle"
          size="sm"
          label="Go live"
        />
        <UButton
          to="/hotlap"
          icon="i-lucide-timer"
          color="neutral"
          variant="outline"
          size="sm"
          label="Hotlap"
        />
      </template>
    </PageHeader>

    <div
      v-if="cars.length === 0"
      class="card-dashed p-8 text-center font-mono text-sm text-zinc-500"
    >
      No sessions in {{ game.label }} yet — go
      <NuxtLink
        to="/live"
        class="text-green-400 underline hover:text-green-300"
      >Live</NuxtLink>
      and record a run.
    </div>

    <section
      v-for="car in cars"
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
          {{ car.tracks.length }} track{{ car.tracks.length === 1 ? '' : 's' }}
        </span>
      </div>

      <div class="card divide-y divide-zinc-800/60 p-0">
        <div
          v-for="tr in car.tracks"
          :key="tr.eventId"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate font-mono text-sm text-zinc-200">
              {{ tr.eventName }}
              <span
                v-if="tr.eventType"
                class="ml-1 text-[10px] uppercase tracking-[0.2em] text-zinc-600"
              >{{ EVENT_TYPE_LABELS[tr.eventType] }}</span>
            </div>
            <div class="font-mono text-[11px] text-zinc-500">
              {{ tr.sessionCount }} session{{ tr.sessionCount === 1 ? '' : 's' }}
              · {{ tr.lapCount }} lap{{ tr.lapCount === 1 ? '' : 's' }}
              <span
                v-if="tr.lastAt"
                class="text-zinc-600"
              >· {{ relativeDate(tr.lastAt) }}</span>
            </div>
          </div>

          <div class="shrink-0 text-right font-mono">
            <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-600">
              Best
            </div>
            <div class="text-sm text-zinc-100 tabular-nums">
              {{ tr.best ? formatLap(tr.best.timeMs) : '—' }}
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            <UButton
              v-if="tr.compareHref"
              :to="tr.compareHref"
              icon="i-lucide-git-compare"
              color="primary"
              variant="subtle"
              size="xs"
              label="Compare"
              class="font-mono text-[10px] uppercase tracking-[0.2em]"
            />
            <UButton
              :to="tr.openHref"
              icon="i-lucide-arrow-right"
              color="neutral"
              variant="outline"
              size="xs"
              label="Open"
              class="font-mono text-[10px] uppercase tracking-[0.2em]"
            />
          </div>
        </div>
      </div>
    </section>
  </main>
</template>
