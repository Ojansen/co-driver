import dgram from 'node:dgram'
import { decodeCarDash } from '../utils/decode'
import { forzaBus } from '../utils/forza-bus'

// ECONNRESET on the WebSocket upgrade socket bubbles up as an
// unhandledRejection when a browser tab is closed abruptly. It's harmless —
// the close handler detaches the bus listener regardless. Filter it so
// the logs stay readable.
let rejectionGuardInstalled = false
function installRejectionGuard() {
  if (rejectionGuardInstalled) return
  rejectionGuardInstalled = true
  process.on('unhandledRejection', (reason) => {
    const code = (reason as { code?: string } | null | undefined)?.code
    if (code === 'ECONNRESET' || code === 'EPIPE') return
    console.error('[forza] unhandled rejection', reason)
  })
}

export default defineNitroPlugin(() => {
  installRejectionGuard()

  const port = Number(process.env.FORZA_PORT ?? 5300)
  const bind = process.env.FORZA_BIND ?? '0.0.0.0'

  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  let frame = 0
  let warnedShort = false

  sock.on('message', (buf) => {
    forzaBus.emit('debug', {
      length: buf.length,
      tailHex: buf.subarray(Math.max(0, buf.length - 8)).toString('hex')
    })

    const t = decodeCarDash(buf)
    if (!t) {
      if (!warnedShort) {
        console.warn(`[forza] received ${buf.length}-byte packet; expected 324 (Car Dash). Check in-game format.`)
        warnedShort = true
      }
      return
    }
    // Throttle 60 Hz -> 30 Hz for browser fan-out.
    if ((frame++ & 1) === 0) forzaBus.emit('telemetry', t)
  })

  sock.on('error', (err) => {
    console.error('[forza] socket error', err)
  })

  sock.bind(port, bind, () => {
    const addr = sock.address()
    console.log(`[forza] listening udp://${addr.address}:${addr.port} (Car Dash @ ~30 Hz)`)
  })
})
