<script setup lang="ts">
import type { Telemetry } from '../../server/utils/decode'

const props = defineProps<{
  frames: Telemetry[]
}>()

const {
  currentFrame,
  history,
  playing,
  playbackRate,
  totalMs,
  elapsedMs,
  toggle,
  pause,
  seekToFraction
} = useReplay(props.frames)

const scrubFraction = computed({
  get(): number {
    if (totalMs.value <= 0) return 0
    return elapsedMs.value / totalMs.value
  },
  set(f: number) {
    seekToFraction(f)
  }
})

function formatTime(ms: number): string {
  const totalSeconds = ms / 1000
  const m = Math.floor(totalSeconds / 60)
  const s = (totalSeconds - m * 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}

function onScrub(e: Event) {
  const target = e.target as HTMLInputElement
  pause()
  seekToFraction(Number(target.value))
}

const RATES = [0.25, 0.5, 1, 2, 4] as const

function pickTickStep(totalS: number): number {
  if (totalS <= 10) return 1
  if (totalS <= 30) return 5
  if (totalS <= 90) return 10
  if (totalS <= 300) return 30
  return 60
}

function formatTick(s: number): string {
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const r = Math.round(s - m * 60)
  return r === 0 ? `${m}m` : `${m}:${r.toString().padStart(2, '0')}`
}

const timeTicks = computed(() => {
  const totalS = totalMs.value / 1000
  if (totalS <= 0) return [] as { percent: number, label: string }[]
  const step = pickTickStep(totalS)
  const ticks: { percent: number, label: string }[] = []
  // Stop one step short of total to avoid colliding with the trailing total label.
  const stop = totalS - step * 0.5
  for (let s = 0; s <= stop; s += step) {
    ticks.push({ percent: (s / totalS) * 100, label: formatTick(s) })
  }
  // Always pin the lap-end label at the right edge.
  ticks.push({ percent: 100, label: formatTick(totalS) })
  return ticks
})

function tickAnchorClass(percent: number): string {
  if (percent < 1) return 'left-0'
  if (percent > 99) return 'right-0'
  return '-translate-x-1/2'
}

function tickStyle(percent: number): Record<string, string> {
  if (percent < 1 || percent > 99) return {}
  return { left: percent + '%' }
}
</script>

<template>
  <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
    <header class="mb-3 flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <span>Replay · {{ frames.length }} frames</span>
      <span class="tabular-nums text-zinc-300">
        {{ formatTime(elapsedMs) }} / {{ formatTime(totalMs) }}
      </span>
    </header>

    <CornerView
      :frame="currentFrame"
      :paused="false"
    />

    <section class="mx-auto max-w-6xl px-6 pb-2">
      <TraceStrip
        :history="history"
        :paused="!playing"
        @toggle-pause="toggle"
      />
    </section>

    <div class="mx-auto mt-2 flex max-w-6xl items-center gap-3 px-6">
      <button
        type="button"
        class="rounded-sm border border-zinc-700 bg-zinc-900 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-green-500/60 hover:text-green-300"
        @click="toggle"
      >
        {{ playing ? '❚❚ Pause' : '▶ Play' }}
      </button>
      <div class="flex flex-1 flex-col gap-0.5">
        <input
          :value="scrubFraction"
          type="range"
          min="0"
          max="1"
          step="0.001"
          class="w-full accent-green-400"
          @input="onScrub"
        >
        <div
          v-if="timeTicks.length > 0"
          class="relative h-3 select-none font-mono text-[9px] tabular-nums text-zinc-500"
        >
          <span
            v-for="tick in timeTicks"
            :key="tick.percent"
            class="absolute top-0"
            :class="tickAnchorClass(tick.percent)"
            :style="tickStyle(tick.percent)"
          >{{ tick.label }}</span>
        </div>
      </div>
      <select
        v-model.number="playbackRate"
        class="rounded-sm border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-200"
      >
        <option
          v-for="r in RATES"
          :key="r"
          :value="r"
        >
          {{ r }}x
        </option>
      </select>
    </div>
  </div>
</template>
