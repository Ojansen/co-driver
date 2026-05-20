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
      <input
        :value="scrubFraction"
        type="range"
        min="0"
        max="1"
        step="0.001"
        class="flex-1 accent-green-400"
        @input="onScrub"
      >
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
