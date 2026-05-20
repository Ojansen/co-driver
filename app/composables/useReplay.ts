import type { Telemetry } from '../../server/utils/decode'
import { TRACE_BUFFER_SIZE, type TraceSample } from '../utils/trace'

/**
 * Drives a saved-lap playback.
 *
 * Playback is anchored: when play() is called, we snapshot the wall clock
 * and current frame's game timestamp. Each RAF tick, wall elapsed × playback
 * rate gives the target game time; we advance currentIndex to the latest
 * frame whose timestamp is ≤ target. Re-anchors on rate change or seek to
 * keep the wall/game clock relationship clean.
 */
export function useReplay(initialFrames: Telemetry[]) {
  const frames = ref<Telemetry[]>(initialFrames)
  const currentIndex = ref(0)
  const playing = ref(false)
  const playbackRate = ref(1)

  let rafId: number | null = null
  let anchorWallMs = 0
  let anchorGameMs = 0

  const currentFrame = computed<Telemetry | null>(() => {
    const list = frames.value
    return list[currentIndex.value] ?? null
  })

  // Trace history is the recent slice of frames mapped to TraceSample,
  // mirroring what useTelemetry would have produced live.
  const history = computed<TraceSample[]>(() => {
    const list = frames.value
    const end = currentIndex.value + 1
    const start = Math.max(0, end - TRACE_BUFFER_SIZE)
    const out: TraceSample[] = []
    for (let i = start; i < end; i++) {
      const f = list[i]
      if (!f) continue
      out.push({
        t: f.timestampMs,
        throttle: f.throttle,
        brake: f.brake,
        steer: f.steer,
        yawRate: f.angularVelocity.y
      })
    }
    return out
  })

  const totalMs = computed(() => {
    const list = frames.value
    const first = list[0]
    const last = list[list.length - 1]
    if (!first || !last) return 0
    return last.timestampMs - first.timestampMs
  })

  const elapsedMs = computed(() => {
    const list = frames.value
    const first = list[0]
    const cur = currentFrame.value
    if (!first || !cur) return 0
    return cur.timestampMs - first.timestampMs
  })

  function reanchor() {
    const f = currentFrame.value
    if (!f) return
    anchorWallMs = performance.now()
    anchorGameMs = f.timestampMs
  }

  function loop() {
    rafId = null
    if (!playing.value) return
    const list = frames.value
    if (list.length === 0) {
      playing.value = false
      return
    }

    const wallElapsed = performance.now() - anchorWallMs
    const targetGameMs = anchorGameMs + wallElapsed * playbackRate.value

    let i = currentIndex.value
    while (i < list.length - 1) {
      const next = list[i + 1]
      if (!next || next.timestampMs > targetGameMs) break
      i++
    }
    currentIndex.value = i

    if (i >= list.length - 1) {
      playing.value = false
      return
    }
    rafId = requestAnimationFrame(loop)
  }

  function play() {
    if (playing.value) return
    if (frames.value.length === 0) return
    if (currentIndex.value >= frames.value.length - 1) {
      currentIndex.value = 0
    }
    reanchor()
    playing.value = true
    rafId = requestAnimationFrame(loop)
  }

  function pause() {
    playing.value = false
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function toggle() {
    if (playing.value) pause()
    else play()
  }

  function seekToIndex(i: number) {
    const list = frames.value
    if (list.length === 0) return
    const clamped = Math.max(0, Math.min(list.length - 1, i))
    currentIndex.value = clamped
    if (playing.value) reanchor()
  }

  function seekToFraction(f: number) {
    const list = frames.value
    if (list.length <= 1) return
    seekToIndex(Math.round(f * (list.length - 1)))
  }

  function setFrames(newFrames: Telemetry[]) {
    pause()
    frames.value = newFrames
    currentIndex.value = 0
  }

  watch(playbackRate, () => {
    if (playing.value) reanchor()
  })

  if (import.meta.client) {
    onBeforeUnmount(() => {
      pause()
    })
  }

  return {
    frames,
    currentIndex,
    currentFrame,
    history,
    playing,
    playbackRate,
    totalMs,
    elapsedMs,
    play,
    pause,
    toggle,
    seekToIndex,
    seekToFraction,
    setFrames
  }
}
