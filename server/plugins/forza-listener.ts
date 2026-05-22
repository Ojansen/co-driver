import dgram from 'node:dgram'
import { decodeCarDash } from '../utils/decode'
import { forzaBus, getForzaStatus, setForzaStatus, bumpForzaLastPacket } from '../utils/forza-bus'

// Connection watchdog: Forza UDP is connectionless, so "connected" means
// "we received a packet in the last STALE_MS". This drives the UI badge.
const STALE_MS = 1000
const TICK_MS = 500

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
  let warnedShort = false
  let firstPacketLogged = false

  sock.on('message', (buf, rinfo) => {
    const now = Date.now()
    if (!firstPacketLogged) {
      console.log(`[forza] first packet received: ${buf.length} bytes from ${rinfo.address}:${rinfo.port}`)
      firstPacketLogged = true
    }
    if (!getForzaStatus().connected) {
      setForzaStatus({ connected: true, lastPacketAt: now })
    } else {
      bumpForzaLastPacket(now)
    }

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
    forzaBus.emit('telemetry', t)
  })

  sock.on('error', (err) => {
    console.error('[forza] socket error', err)
  })

  sock.bind(port, bind, () => {
    const addr = sock.address()
    console.log(`[forza] listening udp://${addr.address}:${addr.port} (Car Dash @ ~60 Hz)`)
    console.log('[forza] waiting for first packet — set Forza Data Out to this host\'s LAN IP and port above')
  })

  const watchdog = setInterval(() => {
    const s = getForzaStatus()
    const stale = s.lastPacketAt === null || (Date.now() - s.lastPacketAt) > STALE_MS
    if (s.connected && stale) {
      setForzaStatus({ connected: false, lastPacketAt: s.lastPacketAt })
    }
  }, TICK_MS)
  watchdog.unref()
})
