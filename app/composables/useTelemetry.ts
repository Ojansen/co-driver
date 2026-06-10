import type { Telemetry } from '../../server/utils/decode'
import type { MeasurementBand, MeasurementEvent, RecordingState, TunePrompt } from '../../server/utils/forza-bus'
import { mergeBands } from '../utils/measurement-bands'
import { TRACE_BUFFER_SIZE, pushSample, type TraceSample } from '../utils/trace'

/** One reading of a rolling server-computed measurement. */
export interface MeasurementSample {
  /** 0..1 ratio, or NaN when the window had no qualifying frames. */
  value: number
  /** Game-clock ms — window start. */
  startMs: number
  /** Game-clock ms — window end (= "now" at emission). */
  endMs: number
}

/** Cap recent-readings buffer per measurement. 60 s at 5 Hz = 300; leaves
 *  headroom past the 30 s strip window for any future zoom-out. */
const MEASUREMENT_BUFFER_SIZE = 300

/** Window past which client-side bands are dropped — matches the server's
 *  rolling window so a band ages out once it scrolls off the strip. */
const MEASUREMENT_WINDOW_MS = 30_000

/**
 * Pause source for the live trace strip + DVR scrub.
 *  - 'live':  panels follow the latest telemetry frame; trace is rolling.
 *  - 'game':  Forza paused the race; trace freezes; user can scrub history.
 *  - 'user':  user hit PAUSE manually; sticky across a game-resume edge.
 */
type PauseSource = 'live' | 'user' | 'game'

interface ServerMessage {
  type: 'hello' | 'telemetry' | 'recording_state' | 'tune_prompt' | 'forza_status' | 'error' | 'measurement'
  t?: Telemetry
  message?: string
  // recording_state fields
  state?: 'idle' | 'recording'
  sessionId?: number
  eventId?: number
  carOrdinal?: number
  carDisplayName?: string | null
  carClass?: number
  piAtStart?: number
  tuneLabel?: string | null
  lapsCompleted?: number
  // tune_prompt fields
  previousPi?: number
  currentPi?: number
  // forza_status fields
  connected?: boolean
  lastPacketAt?: number | null
  // measurement
  m?: MeasurementEvent
}

// Telemetry frames are wholesale-replaced (never mutated), and TraceSample/
// Telemetry buffer entries are read by index — neither needs deep reactivity.
// Using shallowRef + markRaw on pushed items avoids Vue proxying ~1800 deeply-
// nested telemetry objects, which was driving the bulk of live-view RAM.
const _state = {
  telemetry: shallowRef<Telemetry | null>(null),
  // Last car identity (ordinal/class) seen with ordinal > 0. Forza zeros
  // these fields on the pause menu and pre-race UI even while packets keep
  // arriving, so `telemetry.value.car.ordinal` reads 0 during pause — use
  // this instead when you want the *current car*, not "what the wire said
  // this instant".
  lastLiveCar: shallowRef<{ ordinal: number, class: number, pi: number } | null>(null),
  connected: ref(false),
  forzaConnected: ref(false),
  forzaLastPacketAt: ref<number | null>(null),
  hasReceivedFrame: ref(false),
  history: ref<TraceSample[]>([]),
  framesBuffer: ref<Telemetry[]>([]),
  pauseSource: ref<PauseSource>('live'),
  scrubIndex: ref<number | null>(null),
  recording: ref<RecordingState>({ state: 'idle' }),
  tunePrompt: ref<TunePrompt | null>(null),
  // Bounded ring of recent rolling-measurement readings, keyed by name. New
  // measurements drop in here as the server emits them; consumers read by
  // name and render the series however they like (sparkline, badge, etc.).
  measurements: shallowRef<{
    tbRolling: MeasurementSample[]
    timeCoast: MeasurementSample[]
    pedalOverlap: MeasurementSample[]
    // Discrete trail-braking bands for the TB% strip (rect render). Deduped by
    // startMs as the server re-sends in-window bands each emit.
    tbBands: MeasurementBand[]
  }>({ tbRolling: [], timeCoast: [], pedalOverlap: [], tbBands: [] }),
  lastError: ref<string | null>(null),
  ws: null as WebSocket | null,
  refCount: 0,
  // Set when we close the WS ourselves because the tab went hidden — tells
  // the onclose handler not to schedule an auto-reconnect. Cleared when the
  // tab becomes visible again.
  suspendedForHidden: false,
  visibilityListenerAttached: false
}

// rAF-coalesced telemetry commit. The WS delivers ~60 Hz, but rendering the
// live panels is driven per packet with no backpressure: a client that can't
// finish a frame's work inside the paint budget falls progressively further
// behind, so the lag grows over a long session rather than holding steady.
// Queue incoming frames and commit once per animation frame —
//   - `history`/`framesBuffer` keep EVERY queued sample, so trace resolution is
//     unchanged in the common 1:1 (one packet per paint) case;
//   - the reactive `telemetry` driver — which re-renders the heavy CornerView —
//     updates at most once per paint;
//   - the whole queue drains in one synchronous batch, so a burst (e.g. the
//     server stalling on GC then flushing several frames at once) collapses to
//     a single render instead of piling up.
// rAF also self-throttles to the display refresh and never fires while the tab
// is hidden, so the queue can't grow unbounded in the background.
let _pendingFrames: Telemetry[] = []
let _flushScheduled = false

function flushTelemetry(): void {
  _flushScheduled = false
  const batch = _pendingFrames
  if (batch.length === 0) return
  _pendingFrames = []

  for (const t of batch) {
    if (t.car.ordinal > 0) {
      _state.lastLiveCar.value = { ordinal: t.car.ordinal, class: t.car.class, pi: t.car.pi }
    }

    // Drive pause-source transitions from the game's race state. Run per frame
    // (not just on the batch's last) so a transition inside a burst isn't lost.
    // - live + race-off → upgrade to 'game' so panels freeze and DVR engages
    // - game + race-on  → drop back to 'live' and clear any scrub
    // - 'user' is sticky in both directions (manual pause survives game edges)
    if (_state.pauseSource.value === 'live' && !t.isRaceOn) {
      _state.pauseSource.value = 'game'
    } else if (_state.pauseSource.value === 'game' && t.isRaceOn) {
      _state.pauseSource.value = 'live'
      _state.scrubIndex.value = null
    }

    // Push to BOTH buffers while genuinely live so their indices stay aligned.
    // The instant the race goes off or the user pauses, both freeze.
    if (t.isRaceOn && _state.pauseSource.value === 'live') {
      const buf = _state.framesBuffer.value
      buf.push(t)
      while (buf.length > TRACE_BUFFER_SIZE) buf.shift()
      pushSample(_state.history.value, markRaw({
        t: t.timestampMs,
        throttle: t.throttle,
        brake: t.brake,
        steer: t.steer,
        yawRate: t.angularVelocity.y,
        rpm: t.rpm,
        rpmMax: t.rpmMax,
        torqueNm: t.torque ?? 0,
        powerKw: t.power / 1000
      }))
    }
  }

  // Single render-driver update per paint: panels read the freshest frame.
  _state.telemetry.value = batch[batch.length - 1]!
  _state.hasReceivedFrame.value = true
}

function queueTelemetry(t: Telemetry): void {
  _pendingFrames.push(t)
  if (_flushScheduled) return
  _flushScheduled = true
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(flushTelemetry)
  } else {
    // No rAF available (non-browser) — commit synchronously so nothing stalls.
    flushTelemetry()
  }
}

// Backgrounded tabs get aggressively throttled by browsers (Chrome caps the
// main thread at ~1Hz after ~5 min hidden) while the server keeps sending
// 60Hz telemetry. The backlog hammers the main thread on return — multi-
// second freeze. Cut the source: close the socket while hidden, reconnect
// on return. Server re-sends recording_state + forza_status on open, so UI
// re-syncs in one round trip. See GH issue #6.
function attachVisibilityListener() {
  if (_state.visibilityListenerAttached) return
  if (typeof document === 'undefined') return
  _state.visibilityListenerAttached = true
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _state.suspendedForHidden = true
      // Drop stale trace so the strip doesn't flash 30s-old data on return.
      // Keep `telemetry.value` so the corner panels don't blank out.
      _state.history.value = []
      _state.framesBuffer.value = []
      _state.scrubIndex.value = null
      _state.measurements.value = { tbRolling: [], timeCoast: [], pedalOverlap: [], tbBands: [] }
      // Drop any frames queued for the next paint so the strip doesn't flash a
      // stale burst on return; a scheduled rAF will no-op on the empty batch.
      _pendingFrames = []
      const ws = _state.ws
      if (ws) {
        _state.ws = null
        ws.close()
      }
    } else {
      _state.suspendedForHidden = false
      if (_state.refCount > 0 && !_state.ws) connect()
    }
  })
}

function connect() {
  if (_state.ws) return
  if (typeof window === 'undefined') return
  attachVisibilityListener()
  // Don't open while hidden — covers both ongoing suspension and the
  // "opened directly into a background tab" case where visibilitychange
  // hasn't fired yet. The listener will reconnect on return.
  if (typeof document !== 'undefined' && document.hidden) {
    _state.suspendedForHidden = true
    return
  }
  if (_state.suspendedForHidden) return

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_ws`
  const ws = new WebSocket(url)
  _state.ws = ws

  ws.onopen = () => {
    _state.connected.value = true
  }
  ws.onclose = () => {
    _state.connected.value = false
    // We've lost ground truth about Forza — show as disconnected until the
    // server tells us otherwise on reconnect.
    _state.forzaConnected.value = false
    _state.ws = null
    if (_state.refCount > 0 && !_state.suspendedForHidden) setTimeout(connect, 1000)
  }
  ws.onerror = () => {
    ws.close()
  }
  ws.onmessage = (e) => {
    let msg: ServerMessage
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (msg.type === 'telemetry' && msg.t) {
      // Coalesce to the next animation frame (see flushTelemetry). markRaw so
      // the deep telemetry object isn't proxied while it sits in the queue.
      queueTelemetry(markRaw(msg.t))
    } else if (msg.type === 'recording_state' && msg.state) {
      if (msg.state === 'idle') {
        _state.recording.value = { state: 'idle' }
      } else if (
        msg.state === 'recording'
        && typeof msg.sessionId === 'number'
        && typeof msg.eventId === 'number'
        && typeof msg.carOrdinal === 'number'
        && typeof msg.carClass === 'number'
        && typeof msg.piAtStart === 'number'
        && typeof msg.lapsCompleted === 'number'
      ) {
        _state.recording.value = {
          state: 'recording',
          sessionId: msg.sessionId,
          eventId: msg.eventId,
          carOrdinal: msg.carOrdinal,
          carDisplayName: msg.carDisplayName ?? null,
          carClass: msg.carClass,
          piAtStart: msg.piAtStart,
          tuneLabel: msg.tuneLabel ?? null,
          lapsCompleted: msg.lapsCompleted
        }
      }
    } else if (
      msg.type === 'tune_prompt'
      && typeof msg.sessionId === 'number'
      && typeof msg.carOrdinal === 'number'
      && typeof msg.previousPi === 'number'
      && typeof msg.currentPi === 'number'
    ) {
      _state.tunePrompt.value = {
        sessionId: msg.sessionId,
        carOrdinal: msg.carOrdinal,
        previousPi: msg.previousPi,
        currentPi: msg.currentPi
      }
    } else if (msg.type === 'forza_status' && typeof msg.connected === 'boolean') {
      _state.forzaConnected.value = msg.connected
      _state.forzaLastPacketAt.value = msg.lastPacketAt ?? null
    } else if (msg.type === 'measurement' && msg.m) {
      // Bounded append per measurement name. shallowRef + triggerRef so the
      // array mutation triggers reactivity exactly once per push.
      const m = msg.m
      const bucket = _state.measurements.value
      let ring: MeasurementSample[] | null = null
      if (m.name === 'tb_rolling') ring = bucket.tbRolling
      else if (m.name === 'time_coast') ring = bucket.timeCoast
      else if (m.name === 'pedal_overlap') ring = bucket.pedalOverlap
      if (ring) {
        ring.push({ value: m.value, startMs: m.startMs, endMs: m.endMs })
        while (ring.length > MEASUREMENT_BUFFER_SIZE) ring.shift()
      }
      // Dedupe + age out TB% bands alongside the scalar reading.
      if (m.name === 'tb_rolling' && m.bands) {
        bucket.tbBands = mergeBands(bucket.tbBands, m.bands, m.endMs - MEASUREMENT_WINDOW_MS)
      }
      if (ring || (m.name === 'tb_rolling' && m.bands)) {
        triggerRef(_state.measurements)
      }
    } else if (msg.type === 'error' && msg.message) {
      _state.lastError.value = msg.message
    }
  }
}

function sendCommand(payload: Record<string, unknown>): boolean {
  const ws = _state.ws
  if (!ws || ws.readyState !== WebSocket.OPEN) return false
  ws.send(JSON.stringify(payload))
  return true
}

export function useTelemetry() {
  if (import.meta.client) {
    _state.refCount += 1
    connect()
    onBeforeUnmount(() => {
      _state.refCount -= 1
      if (_state.refCount === 0 && _state.ws) {
        _state.ws.close()
        _state.ws = null
      }
    })
  }

  const paused = computed<boolean>(() => _state.pauseSource.value !== 'live')

  const displayFrame = computed<Telemetry | null>(() => {
    const idx = _state.scrubIndex.value
    if (idx !== null) {
      return _state.framesBuffer.value[idx] ?? _state.telemetry.value
    }
    return _state.telemetry.value
  })

  function setScrub(i: number | null): void {
    if (i === null) {
      _state.scrubIndex.value = null
      return
    }
    const len = _state.framesBuffer.value.length
    if (len === 0) return
    _state.scrubIndex.value = Math.max(0, Math.min(len - 1, i))
    // Touching the trace strip implicitly pauses the live feed so the panels
    // don't fight the user's scrub. Game-paused stays game-paused.
    if (_state.pauseSource.value === 'live') {
      _state.pauseSource.value = 'user'
    }
  }

  function pauseManual(): void {
    if (_state.pauseSource.value === 'live') _state.pauseSource.value = 'user'
  }

  function resume(): void {
    _state.pauseSource.value = 'live'
    _state.scrubIndex.value = null
  }

  return {
    telemetry: _state.telemetry,
    lastLiveCar: _state.lastLiveCar,
    connected: _state.connected,
    forzaConnected: _state.forzaConnected,
    forzaLastPacketAt: _state.forzaLastPacketAt,
    hasReceivedFrame: _state.hasReceivedFrame,
    history: _state.history,
    framesBuffer: _state.framesBuffer,
    scrubIndex: _state.scrubIndex,
    pauseSource: _state.pauseSource,
    measurements: _state.measurements,
    paused,
    displayFrame,
    setScrub,
    pauseManual,
    resume
  }
}

export function useRecording() {
  // The session is tagged with whichever game is active (see shared/games.ts).
  // Captured here at setup so the start closure reads the current value at click
  // time without each call site having to pass it.
  const { gameId } = useGame()

  if (import.meta.client) {
    _state.refCount += 1
    connect()
    onBeforeUnmount(() => {
      _state.refCount -= 1
      if (_state.refCount === 0 && _state.ws) {
        _state.ws.close()
        _state.ws = null
      }
    })
  }

  return {
    recording: _state.recording,
    tunePrompt: _state.tunePrompt,
    lastError: _state.lastError,
    connected: _state.connected,
    startRecording: (eventId: number, tuneLabel?: string | null): boolean => {
      _state.lastError.value = null
      return sendCommand({ type: 'start', eventId, gameId: gameId.value, tuneLabel: tuneLabel ?? null })
    },
    stopRecording: (): boolean => {
      _state.lastError.value = null
      return sendCommand({ type: 'stop' })
    },
    clearTunePrompt: (): void => {
      _state.tunePrompt.value = null
    },
    clearError: (): void => {
      _state.lastError.value = null
    }
  }
}
