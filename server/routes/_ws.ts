import { forzaBus, getForzaStatus, type ForzaStatus, type MeasurementEvent, type RecordingState, type TunePrompt } from '../utils/forza-bus'
import { recorder } from '../utils/recorder'
// Side-effect imports: instantiating the singletons subscribes them to the
// bus so rolling measurements start computing as soon as any WS client
// connects.
import '../utils/rolling-tb-percent'
import '../utils/rolling-coast-time'
import '../utils/rolling-pedal-overlap'
import type { Telemetry } from '../utils/decode'

interface StartMessage {
  type: 'start'
  eventId: number
  tuneLabel?: string | null
}

interface StopMessage {
  type: 'stop'
}

type InboundMessage = StartMessage | StopMessage

function parseInbound(raw: unknown): InboundMessage | null {
  let text: string
  if (typeof raw === 'string') {
    text = raw
  } else if (raw && typeof (raw as { text?: () => string }).text === 'function') {
    text = (raw as { text: () => string }).text()
  } else {
    text = String(raw)
  }
  try {
    const parsed = JSON.parse(text) as Partial<InboundMessage>
    if (parsed?.type === 'start' && typeof (parsed as StartMessage).eventId === 'number') {
      return parsed as StartMessage
    }
    if (parsed?.type === 'stop') return parsed as StopMessage
    return null
  } catch {
    return null
  }
}

export default defineWebSocketHandler({
  open(peer) {
    peer.send(JSON.stringify({ type: 'hello' }))
    // Sync new clients to current recording + forza status.
    peer.send(JSON.stringify({ type: 'recording_state', ...recorder.getState() }))
    peer.send(JSON.stringify({ type: 'forza_status', ...getForzaStatus() }))

    const safeSend = (payload: unknown) => {
      try {
        peer.send(JSON.stringify(payload))
      } catch {
        // peer already gone — close handler will detach the listeners.
      }
    }
    const onTelemetry = (t: Telemetry) => safeSend({ type: 'telemetry', t })
    const onRecordingState = (s: RecordingState) => safeSend({ type: 'recording_state', ...s })
    const onTunePrompt = (p: TunePrompt) => safeSend({ type: 'tune_prompt', ...p })
    const onForzaStatus = (s: ForzaStatus) => safeSend({ type: 'forza_status', ...s })
    const onMeasurement = (m: MeasurementEvent) => safeSend({ type: 'measurement', m })

    forzaBus.on('telemetry', onTelemetry)
    forzaBus.on('recording_state', onRecordingState)
    forzaBus.on('tune_prompt', onTunePrompt)
    forzaBus.on('forza_status', onForzaStatus)
    forzaBus.on('measurement', onMeasurement)

    ;(peer as unknown as { _cleanup: () => void })._cleanup = () => {
      forzaBus.off('telemetry', onTelemetry)
      forzaBus.off('recording_state', onRecordingState)
      forzaBus.off('tune_prompt', onTunePrompt)
      forzaBus.off('forza_status', onForzaStatus)
      forzaBus.off('measurement', onMeasurement)
    }
  },
  async message(peer, message) {
    const msg = parseInbound(message)
    if (!msg) return

    const reportError = (err: unknown) => {
      const text = err instanceof Error ? err.message : String(err)
      try {
        peer.send(JSON.stringify({ type: 'error', message: text }))
      } catch {
        // ignore
      }
    }

    try {
      if (msg.type === 'start') {
        await recorder.start(msg.eventId, msg.tuneLabel ?? null)
      } else if (msg.type === 'stop') {
        await recorder.stop()
      }
    } catch (err) {
      reportError(err)
    }
  },
  close(peer) {
    const cleanup = (peer as unknown as { _cleanup?: () => void })._cleanup
    if (cleanup) cleanup()
  }
})
