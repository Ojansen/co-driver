<script setup lang="ts">
const { recording, stopRecording } = useRecording()
const isRecording = computed(() => recording.value.state === 'recording')
const lapsCompleted = computed(() =>
  recording.value.state === 'recording' ? recording.value.lapsCompleted : 0
)

defineProps<{
  withStopButton?: boolean
}>()
</script>

<template>
  <div
    v-if="isRecording"
    class="flex items-center gap-3"
  >
    <span class="flex items-center gap-2 rounded-sm border border-red-500/50 bg-red-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-red-300">
      <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-red-400" />
      REC · {{ lapsCompleted }} lap{{ lapsCompleted === 1 ? '' : 's' }}
    </span>
    <button
      v-if="withStopButton"
      type="button"
      class="rounded-sm border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-red-500/60 hover:text-red-300"
      @click="stopRecording"
    >
      Stop
    </button>
  </div>
</template>
