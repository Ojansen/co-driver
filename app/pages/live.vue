<script setup lang="ts">
const { telemetry, debug, hasReceivedFrame, history, tracePaused } = useTelemetry()

const racePaused = computed(() => Boolean(hasReceivedFrame.value && telemetry.value && !telemetry.value.isRaceOn))

function toggleTracePause() {
  tracePaused.value = !tracePaused.value
}
</script>

<template>
  <div>
    <!-- Waiting state — never received a frame yet -->
    <div
      v-if="!hasReceivedFrame"
      class="flex flex-col items-center justify-center px-6 py-32 text-center font-mono"
    >
      <div class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        awaiting
      </div>
      <div class="mt-3 text-2xl text-zinc-100">
        WAITING FOR TELEMETRY
      </div>
      <div class="mt-6 max-w-md text-xs text-zinc-400">
        Start a race in Forza Horizon with Data Out enabled
        (Settings → HUD and Gameplay → Data Out) and point it at this server's
        LAN IP, port 5300, format <span class="text-zinc-200">Car Dash</span>.
      </div>
    </div>

    <CornerView
      v-else
      :frame="telemetry"
      :paused="racePaused"
    />

    <section
      v-if="hasReceivedFrame"
      class="mx-auto max-w-6xl px-6 pb-6"
    >
      <TraceStrip
        :history="history"
        :paused="tracePaused"
        @toggle-pause="toggleTracePause"
      />
    </section>

    <DebugPanel
      :telemetry="telemetry"
      :debug="debug"
    />
  </div>
</template>
