import type { Telemetry } from '../../server/utils/decode'
import type { DebugFrame, RecordingState, TunePrompt } from '../../server/utils/forza-bus'
import { pushSample, type TraceSample } from '../utils/trace'

interface ServerMessage {
  type: 'hello' | 'telemetry' | 'debug' | 'recording_state' | 'tune_prompt' | 'error'
  t?: Telemetry
  d?: DebugFrame
  message?: string
  // recording_state fields
  state?: 'idle' | 'recording'
  sessionId?: number
  eventId?: number
  carOrdinal?: number
  lapsCompleted?: number
  // tune_prompt fields
  previousPi?: number
  currentPi?: number
}

const _state = {
  telemetry: ref<Telemetry | null>(null),
  debug: ref<DebugFrame | null>(null),
  connected: ref(false),
  hasReceivedFrame: ref(false),
  history: ref<TraceSample[]>([]),
  tracePaused: ref(false),
  recording: ref<RecordingState>({ state: 'idle' }),
  tunePrompt: ref<TunePrompt | null>(null),
  lastError: ref<string | null>(null),
  ws: null as WebSocket | null,
  refCount: 0
}

function connect() {
  if (_state.ws) return
  if (typeof window === 'undefined') return

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_ws`
  const ws = new WebSocket(url)
  _state.ws = ws

  ws.onopen = () => {
    _state.connected.value = true
  }
  ws.onclose = () => {
    _state.connected.value = false
    _state.ws = null
    if (_state.refCount > 0) setTimeout(connect, 1000)
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
      const t = msg.t
      _state.telemetry.value = t
      _state.hasReceivedFrame.value = true
      if (t.isRaceOn && !_state.tracePaused.value) {
        pushSample(_state.history.value, {
          t: t.timestampMs,
          throttle: t.throttle,
          brake: t.brake,
          steer: t.steer,
          yawRate: t.angularVelocity.y
        })
      }
    } else if (msg.type === 'debug' && msg.d) {
      _state.debug.value = msg.d
    } else if (msg.type === 'recording_state' && msg.state) {
      if (msg.state === 'idle') {
        _state.recording.value = { state: 'idle' }
      } else if (
        msg.state === 'recording'
        && typeof msg.sessionId === 'number'
        && typeof msg.eventId === 'number'
        && typeof msg.carOrdinal === 'number'
        && typeof msg.lapsCompleted === 'number'
      ) {
        _state.recording.value = {
          state: 'recording',
          sessionId: msg.sessionId,
          eventId: msg.eventId,
          carOrdinal: msg.carOrdinal,
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

  return {
    telemetry: _state.telemetry,
    debug: _state.debug,
    connected: _state.connected,
    hasReceivedFrame: _state.hasReceivedFrame,
    history: _state.history,
    tracePaused: _state.tracePaused
  }
}

export function useRecording() {
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
      return sendCommand({ type: 'start', eventId, tuneLabel: tuneLabel ?? null })
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
