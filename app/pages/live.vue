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
// visible 30 s. Identity-stable: emits a new lines array only when the
// running max actually shifts. Critical because the TraceStrip lines
// watcher destroys+rebuilds the uPlot instance on identity change, so a
// per-push churn here leaked DOM nodes and event listeners.
const motorLines = shallowRef(motorTraceLines({ maxTorqueNm: 0, maxPowerKw: 0 }))
let lastMaxTq = 0
let lastMaxPw = 0

// Reusable buffer for the trail-braking detector input — avoids ~1800
// object allocations per push at full buffer.
const detectorBuf: Array<{ timestampMs: number, brake: number, steer: number }> = []

const trailBrakingBandsLive = shallowRef<Array<{ startIdx: number, endIdx: number, color?: string }>>([])

watch(() => {
  const h = history.value
  return h.length > 0 ? h[h.length - 1]!.t : -1
}, () => {
  const h = history.value

  // Running max for the motor axis. Epsilon absorbs FP jitter and tiny
  // shifts that wouldn't visibly change the axis anyway.
  let mTq = 0
  let mPw = 0
  for (let i = 0; i < h.length; i++) {
    const s = h[i]!
    if (s.torqueNm > mTq) mTq = s.torqueNm
    if (s.powerKw > mPw) mPw = s.powerKw
  }
  if (Math.abs(mTq - lastMaxTq) > 1 || Math.abs(mPw - lastMaxPw) > 1) {
    lastMaxTq = mTq
    lastMaxPw = mPw
    motorLines.value = motorTraceLines({ maxTorqueNm: mTq, maxPowerKw: mPw })
  }

  // Trail-braking bands. Reuses detectorBuf so we're not allocating 1800
  // adapter objects every push.
  if (h.length < 2) {
    if (trailBrakingBandsLive.value.length > 0) trailBrakingBandsLive.value = []
    return
  }
  while (detectorBuf.length > h.length) detectorBuf.pop()
  while (detectorBuf.length < h.length) detectorBuf.push({ timestampMs: 0, brake: 0, steer: 0 })
  for (let i = 0; i < h.length; i++) {
    const s = h[i]!
    const f = detectorBuf[i]!
    f.timestampMs = s.t
    f.brake = s.brake
    f.steer = s.steer
  }
  trailBrakingBandsLive.value = trailBrakingBands(detectTrailBraking(detectorBuf))
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
