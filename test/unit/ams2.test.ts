import { describe, expect, it } from 'vitest'
import { ams2Adapter } from '../../server/adapters/ams2'

// Minimal SMS Car Physics packet (type 0 @ offset 10).
function carPhysics(): Buffer {
  const buf = Buffer.alloc(556)
  buf.writeUInt8(0, 10) // mPacketType = eCarPhysics
  buf.writeFloatLE(40, 36) // speed 40 m/s -> 144 km/h
  buf.writeUInt16LE(7000, 40) // rpm
  return buf
}

describe('ams2 adapter', () => {
  it('binds to the ams2 id and the shared SMS UDP port', () => {
    expect(ams2Adapter.id).toBe('ams2')
    expect(ams2Adapter.transport).toEqual({ protocol: 'udp', defaultPort: 5606 })
  })

  it('reuses the SMS UDP decoder (Project CARS 2 mode)', () => {
    const t = ams2Adapter.decode(carPhysics())!
    expect(t).not.toBeNull()
    expect(t.speedKmh).toBeCloseTo(144, 1)
    expect(t.rpm).toBe(7000)
  })

  it('rejects undersized packets', () => {
    expect(ams2Adapter.decode(Buffer.alloc(8))).toBeNull()
  })
})
