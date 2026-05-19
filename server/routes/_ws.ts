import { forzaBus, type DebugFrame } from '../utils/forza-bus'
import type { Telemetry } from '../utils/decode'

export default defineWebSocketHandler({
  open(peer) {
    peer.send(JSON.stringify({ type: 'hello' }))

    const safeSend = (payload: unknown) => {
      try {
        peer.send(JSON.stringify(payload))
      } catch {
        // peer already gone — close handler will detach the listeners.
      }
    }
    const onTelemetry = (t: Telemetry) => safeSend({ type: 'telemetry', t })
    const onDebug = (d: DebugFrame) => safeSend({ type: 'debug', d })

    forzaBus.on('telemetry', onTelemetry)
    forzaBus.on('debug', onDebug)

    // Store unsubscribers on the peer so close() can clean up.
    ;(peer as unknown as { _cleanup: () => void })._cleanup = () => {
      forzaBus.off('telemetry', onTelemetry)
      forzaBus.off('debug', onDebug)
    }
  },
  close(peer) {
    const cleanup = (peer as unknown as { _cleanup?: () => void })._cleanup
    if (cleanup) cleanup()
  }
})
