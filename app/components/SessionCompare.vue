<script setup lang="ts">
import { formatDelta, formatLap, relativeDate } from '~/utils/format'
import { diffSetup, SOURCE_LABEL, type SetupDiffRow } from '~/utils/setup-diff'
import type { BuildSettings } from '~/utils/build-fields'
import type { TuneSettings } from '~/utils/tune-fields'

const { format, unitLabel, prefs } = useUnits()

interface SideData {
  sessionId: number
  bestLapMs: number | null
  avgTrailBrakingRatio: number | null
  peakPowerKw: number | null
  buildSnapshot: BuildSettings | null
  tuneSnapshot: TuneSettings | null
  buildName: string | null
  tuneName: string | null
}

const props = defineProps<{
  current: SideData
  prior: (SideData & { startedAt: string }) | null
}>()

// --- Setup diff -----------------------------------------------------------

const diffRows = computed<SetupDiffRow[]>(() => {
  if (!props.prior) return []
  return diffSetup(
    { build: props.current.buildSnapshot, tune: props.current.tuneSnapshot },
    { build: props.prior.buildSnapshot, tune: props.prior.tuneSnapshot }
  )
})

// --- Measurement rows ----------------------------------------------------

interface MeasurementRow {
  label: string
  current: string
  prior: string
  delta: string | null
  direction: 'up' | 'down' | 'flat' | null
}

function arrowFor(currentVal: number | null, priorVal: number | null): 'up' | 'down' | 'flat' | null {
  if (currentVal === null || priorVal === null) return null
  if (currentVal > priorVal) return 'up'
  if (currentVal < priorVal) return 'down'
  return 'flat'
}

function signedDelta(delta: number, suffix: string, decimals = 0): string {
  if (Math.abs(delta) < 0.5) return `0${suffix ? ' ' + suffix : ''}`
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${Math.abs(delta).toFixed(decimals)}${suffix ? ' ' + suffix : ''}`
}

const measurementRows = computed<MeasurementRow[]>(() => {
  if (!props.prior) return []
  const rows: MeasurementRow[] = []

  // Best lap
  const lapDelta = (props.current.bestLapMs !== null && props.prior.bestLapMs !== null)
    ? props.current.bestLapMs - props.prior.bestLapMs
    : null
  rows.push({
    label: 'Best lap',
    current: formatLap(props.current.bestLapMs),
    prior: formatLap(props.prior.bestLapMs),
    delta: lapDelta === null ? null : formatDelta(lapDelta),
    direction: arrowFor(props.current.bestLapMs, props.prior.bestLapMs)
  })

  // Trail-brake ratio (%)
  const tbCurrent = props.current.avgTrailBrakingRatio
  const tbPrior = props.prior.avgTrailBrakingRatio
  const tbDelta = (tbCurrent !== null && tbPrior !== null) ? (tbCurrent - tbPrior) * 100 : null
  rows.push({
    label: 'Trail-brake ratio',
    current: tbCurrent !== null ? Math.round(tbCurrent * 100) + '%' : '—',
    prior: tbPrior !== null ? Math.round(tbPrior * 100) + '%' : '—',
    delta: tbDelta === null ? null : signedDelta(tbDelta, 'pts'),
    direction: arrowFor(tbCurrent, tbPrior)
  })

  // Peak power — converted to the user's unit pref. Delta is computed in the
  // display unit so the magnitude matches what's shown next to it.
  const pkCurrent = props.current.peakPowerKw
  const pkPrior = props.prior.peakPowerKw
  const toDisplayPower = (kw: number) => {
    if (prefs.value.power === 'hp') return kw * 1.34102
    if (prefs.value.power === 'ps') return kw * 1.35962
    return kw
  }
  const pkDelta = (pkCurrent !== null && pkPrior !== null)
    ? toDisplayPower(pkCurrent) - toDisplayPower(pkPrior)
    : null
  rows.push({
    label: 'Peak power',
    current: pkCurrent !== null ? format.power(pkCurrent) : '—',
    prior: pkPrior !== null ? format.power(pkPrior) : '—',
    delta: pkDelta === null ? null : signedDelta(pkDelta, unitLabel.power),
    direction: arrowFor(pkCurrent, pkPrior)
  })

  // Filter to rows where both sides have data — keep the "—" rows hidden.
  return rows.filter(r => r.current !== '—' || r.prior !== '—')
})

function directionGlyph(d: MeasurementRow['direction']): string {
  if (d === 'up') return '↑'
  if (d === 'down') return '↓'
  return ' '
}
</script>

<template>
  <section
    v-if="prior"
    class="card p-4 font-mono"
  >
    <header class="mb-3 flex items-baseline justify-between text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <span>vs session #{{ prior.sessionId }}</span>
      <span
        :title="new Date(prior.startedAt).toLocaleString()"
        class="normal-case tracking-normal text-zinc-400"
      >{{ relativeDate(prior.startedAt) }}</span>
    </header>

    <!-- Measurement rows -->
    <div
      v-if="measurementRows.length"
      class="mb-4 divide-y divide-zinc-800/60"
    >
      <div
        v-for="row in measurementRows"
        :key="row.label"
        class="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-4 py-1.5 text-sm tabular-nums"
      >
        <span class="text-zinc-400">{{ row.label }}</span>
        <span class="text-zinc-100">{{ row.current }}</span>
        <span class="text-zinc-500">← {{ row.prior }}</span>
        <span
          v-if="row.delta"
          class="text-right text-zinc-300"
        >
          <span class="mr-1 text-zinc-500">{{ directionGlyph(row.direction) }}</span>{{ row.delta }}
        </span>
        <span v-else />
      </div>
    </div>

    <!-- Setup diff -->
    <div v-if="diffRows.length">
      <div class="mb-2 text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        Setup diff <span class="ml-2 text-zinc-600 normal-case tracking-normal">{{ diffRows.length }} change{{ diffRows.length === 1 ? '' : 's' }}</span>
      </div>
      <ul class="space-y-1 text-sm">
        <li
          v-for="row in diffRows"
          :key="`${row.source}:${row.fieldId}`"
          class="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 tabular-nums"
        >
          <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            {{ SOURCE_LABEL[row.source] }} · {{ row.section }}
          </span>
          <span class="text-zinc-200">
            {{ row.fieldLabel }}
          </span>
          <span class="text-right text-zinc-300">
            {{ row.currentValue }} <span class="text-zinc-500">← {{ row.priorValue }}</span>
          </span>
        </li>
      </ul>
    </div>
  </section>
</template>
