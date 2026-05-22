<script setup lang="ts">
import { INPUT_TRACE_LINES, motorTraceLines } from '~/utils/trace-lines'
import { detectTrailBraking, trailBrakingBands } from '~/utils/trail-braking'

const {
  telemetry,
  debug,
  hasReceivedFrame,
  history,
  displayFrame,
  scrubIndex,
  paused,
  pauseSource,
  pauseManual,
  resume,
  setScrub
} = useTelemetry()

function onTogglePause() {
  if (paused.value) resume()
  else pauseManual()
}

// How far back from "now" the current scrub target is, in seconds.
const dvrSeconds = computed<number | null>(() => {
  const idx = scrubIndex.value
  if (idx === null) return null
  const h = history.value
  if (h.length === 0) return null
  const last = h[h.length - 1]
  const at = h[idx]
  if (!last || !at) return null
  return Math.max(0, (last.t - at.t) / 1000)
})

// Motor strip's axis auto-scale — running max of torque/power across the
// visible 30 s. O(n) per recompute, n ≤ 1800; cheap.
const motorLines = computed(() => {
  const h = history.value
  let mTq = 0
  let mPw = 0
  for (let i = 0; i < h.length; i++) {
    const s = h[i]!
    if (s.torqueNm > mTq) mTq = s.torqueNm
    if (s.powerKw > mPw) mPw = s.powerKw
  }
  return motorTraceLines({ maxTorqueNm: mTq, maxPowerKw: mPw })
})

// Trail-braking bands: shade the brake-trace where the driver was braking
// AND turning AND the brake was higher recently in the window. See
// app/utils/trail-braking.ts and /tune/brakes for the why.
const trailBrakingBandsLive = computed(() => {
  const h = history.value
  if (h.length < 2) return []
  const detectorFrames = new Array<{ timestampMs: number, brake: number, steer: number }>(h.length)
  for (let i = 0; i < h.length; i++) {
    const s = h[i]!
    detectorFrames[i] = { timestampMs: s.t, brake: s.brake, steer: s.steer }
  }
  return trailBrakingBands(detectTrailBraking(detectorFrames))
})
</script>

<template>
  <div class="container mx-auto max-w-6xl">
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
      :frame="displayFrame"
      :paused="paused && scrubIndex === null"
    />

    <section
      v-if="hasReceivedFrame"
      class="space-y-3 px-6 pb-6"
    >
      <TraceStrip
        :history="history"
        :lines="INPUT_TRACE_LINES"
        label="traces · last 30 s"
        :paused="paused"
        :scrubbable="true"
        :scrub-index="scrubIndex"
        :buffer-length="history.length"
        :bands="trailBrakingBandsLive"
        @toggle-pause="onTogglePause"
        @scrub="setScrub"
      />
      <TraceStrip
        :history="history"
        :lines="motorLines"
        label="motor · last 30 s"
        :paused="paused"
        :scrubbable="true"
        :scrub-index="scrubIndex"
        :buffer-length="history.length"
        :show-pause-button="false"
        @scrub="setScrub"
      />
    </section>

    <!-- DVR scrub badge: how far back of "now" we're showing -->
    <div
      v-if="dvrSeconds !== null"
      class="pointer-events-none fixed bottom-32 left-1/2 z-30 -translate-x-1/2 border-y border-zinc-700/60 bg-zinc-950/60 px-6 py-2 font-mono text-sm uppercase tracking-[0.3em] text-zinc-100 backdrop-blur-sm"
    >
      DVR −{{ dvrSeconds.toFixed(1) }}s
      <span class="ml-3 text-[10px] tracking-[0.2em] text-zinc-500">
        {{ pauseSource === 'game' ? 'game paused' : 'manual pause' }}
      </span>
    </div>

    <DebugPanel
      :telemetry="telemetry"
      :debug="debug"
    />
  </div>
</template>
