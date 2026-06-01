# Forza Telemetry & Car Debugger

> **Status: closed (2026-05-20).** This document captured the v1–v3 design and
> the original v4 roadmap. Everything in it either shipped or was deferred to
> a standalone wishlist (see §10). Future feature work plans separately —
> don't extend this doc. The packet layout in §2 and the architectural
> rationale in §6 and §8.9 remain useful reference; the rest is historical.
> See `git log` for what landed after this doc closed.

A self-hosted, local-first tuning telemetry tool for Forza Horizon. Subscribes to the game's UDP "Data Out" stream, decodes the Car Dash packet, and renders live SVG views designed for tuning workflows — not for looking pretty on a stream overlay.

Runs entirely on the user's machine. No accounts, no cloud, no analytics. The game broadcasts UDP, Nuxt listens, the browser draws — that's the whole loop.

---

## 1. Stack

- **Nuxt 4** (server + client in one project)
- **Nitro** for the server — UDP listener lives in a Nitro plugin, telemetry is fanned out to clients over a Nitro WebSocket handler
- **Tailwind 4** for layout
- **Inline SVG** for all gauges, corner views, traces (art-in-code; no asset pipeline)
- **bun** as package manager + runtime for dev (matches Helios / Cozy Hub)
- **Playwright + Vitest** for tests (corner-view rendering snapshot, decoder unit tests)

v1 has no database. v3 introduces persistent capture into **drizzle + libsql** via `@nuxthub/db`, with one gzipped frames blob per lap. See §8 for the full data model.

---

## 2. The Forza "Data Out" stream

### How the game sends it

- UDP, fire-and-forget, no handshake.
- ~60 packets/sec while a race is on.
- Configured in-game: **Settings → HUD and Gameplay → Data Out** → set IP, port, format.
- Format must be **Car Dash** (the richer one). "Sled" is a subset and lacks tire temp, inputs, and lap info.

### Packet layout (Forza Horizon Car Dash, 324 bytes)

The packet is a contiguous binary struct, little-endian. The Horizon variant has a 12-byte gap between the Sled portion and the Dash extension — this is a known quirk inherited from how Horizon repackaged the Motorsport packet.

**Sled portion (offsets 0..231)** — shared with Motorsport's Sled format:

| Offset | Type | Field |
|---:|---|---|
| 0 | s32 | IsRaceOn (0 when paused / in menu — discard these packets) |
| 4 | u32 | TimestampMS |
| 8 | f32 | EngineMaxRpm |
| 12 | f32 | EngineIdleRpm |
| 16 | f32 | CurrentEngineRpm |
| 20..28 | f32×3 | Acceleration X/Y/Z (m/s²) |
| 32..40 | f32×3 | Velocity X/Y/Z |
| 44..52 | f32×3 | AngularVelocity X/Y/Z |
| 56 | f32 | Yaw |
| 60 | f32 | Pitch |
| 64 | f32 | Roll |
| 68..80 | f32×4 | **NormalizedSuspensionTravel** FL/FR/RL/RR (0..1, 1 = fully compressed) |
| 84..96 | f32×4 | **TireSlipRatio** FL/FR/RL/RR (0 = grip, >1 = wheelspin/lockup) |
| 100..112 | f32×4 | WheelRotationSpeed FL/FR/RL/RR (rad/s) |
| 116..128 | f32×4 | WheelOnRumbleStrip FL/FR/RL/RR (0/1) |
| 132..144 | f32×4 | WheelInPuddleDepth FL/FR/RL/RR |
| 148..160 | f32×4 | SurfaceRumble FL/FR/RL/RR |
| 164..176 | f32×4 | **TireSlipAngle** FL/FR/RL/RR (lateral slip) |
| 180..192 | f32×4 | **TireCombinedSlip** FL/FR/RL/RR (sqrt(ratio² + angle²)) |
| 196..208 | f32×4 | **SuspensionTravelMeters** FL/FR/RL/RR |
| 212 | s32 | CarOrdinal (the car's unique ID in Forza's catalog) |
| 216 | s32 | CarClass (0=D … 7=X) |
| 220 | s32 | CarPerformanceIndex |
| 224 | s32 | DrivetrainType (0=FWD, 1=RWD, 2=AWD) |
| 228 | s32 | NumCylinders |

**Horizon gap: offsets 232..243** — 12 bytes of unknown/padding. Skip them. Some community parsers mark this as "HUD type" or undocumented; nothing tuning-relevant lives here.

**Dash extension (offsets 244..323)** — Horizon-specific car/race state:

| Offset | Type | Field |
|---:|---|---|
| 244..252 | f32×3 | Position X/Y/Z (world coords) |
| 256 | f32 | **Speed** (m/s — multiply by 3.6 for km/h or 2.237 for mph) |
| 260 | f32 | Power (Watts) |
| 264 | f32 | Torque (Nm) |
| 268..280 | f32×4 | **TireTemp** FL/FR/RL/RR (°F — convert if you prefer °C) |
| 284 | f32 | Boost |
| 288 | f32 | Fuel (0..1) |
| 292 | f32 | DistanceTraveled (m) |
| 296 | f32 | BestLap (s) |
| 300 | f32 | LastLap (s) |
| 304 | f32 | CurrentLap (s) |
| 308 | f32 | CurrentRaceTime (s) |
| 312 | u16 | LapNumber |
| 314 | u8 | RacePosition |
| 315 | u8 | **Accel** (0..255 — throttle) |
| 316 | u8 | **Brake** (0..255) |
| 317 | u8 | Clutch (0..255) |
| 318 | u8 | HandBrake (0..255) |
| 319 | u8 | **Gear** (0=R, 1=N, 2..=1st…) |
| 320 | s8 | **Steer** (-127..127) |
| 321 | s8 | NormalizedDrivingLine |
| 322 | s8 | NormalizedAIBrakeDifference |
| 323 | — | unused / padding |

> ⚠️ FH5 may have shifted/added fields in late updates. The decoder should log packet length on first receipt; if it's not 324 bytes, dump the trailing bytes to console so we can map the rest.

### What matters for tuning, per signal

- **NormalizedSuspensionTravel** + **SuspensionTravelMeters**: bottoming out on bumps → springs too soft / bumpstops too short. Asymmetric L/R compression in steady-state cornering → ARB too stiff that axis.
- **TireSlipRatio**: longitudinal slip. >0.1 under power on driven wheels = wheelspin (diff/traction). >0.1 under braking = lockup (brake bias).
- **TireSlipAngle**: lateral slip. Front > rear = understeer. Rear > front = oversteer. Compare in mid-corner.
- **TireCombinedSlip**: the magnitude. Past ~1.0 you're off the friction circle.
- **TireTemp**: hot inner edge → too much camber. Hot outer → not enough. Front pair >> rear = understeer-bias setup. Target is roughly even temps across all four after a few laps.
- **Accel/Brake** as u8: input traces help separate driver from car.
- **Boost**: monitor turbo lag / overrun.

---

## 3. Architecture

```
┌──────────────────┐    UDP 5300    ┌──────────────────────┐
│  Forza Horizon   │ ─────────────► │  Nitro plugin         │
│  Data Out: ON    │  ~60 pkt/sec   │  (dgram socket)       │
└──────────────────┘                │   decodes packet      │
                                    │   emits on EventBus   │
                                    └──────────┬───────────┘
                                               │
                                  EventEmitter │
                                               ▼
                                    ┌──────────────────────┐
                                    │  Nitro WS handler     │
                                    │  /_ws                 │
                                    │  fans out to peers    │
                                    └──────────┬───────────┘
                                               │ ws frames (JSON or binary)
                                               ▼
                                    ┌──────────────────────┐
                                    │  Vue page             │
                                    │  reactive store       │
                                    │  SVG corner view      │
                                    └──────────────────────┘
```

### Components

- **`server/utils/forza-bus.ts`** — exports a singleton `EventEmitter`. Plugin emits, WS handler + recorder subscribe.
- **`server/utils/decode.ts`** — single function `decodeCarDash(buf: Buffer): Telemetry`. Pure, well-tested.
- **`server/plugins/forza-listener.ts`** — binds the UDP socket, decodes every valid packet, emits at the native ~60 Hz Forza rate.
- **`server/routes/_ws.ts`** — `defineWebSocketHandler`. Subscribes peers to the bus; also parses `start` / `stop` inbound commands for the recorder.
- **`server/utils/recorder.ts`** — v3 state machine. See §8.3.
- **`pages/live.vue`** — the corner view dashboard (canonical URL). `pages/index.vue` redirects `/` → `/live`.
- **`composables/useTelemetry.ts`** — opens the WebSocket; exposes `telemetry`, `connected`, plus a `useRecording()` peer for the start/stop UI.

### Render cadence

The game emits at ~60 Hz. The server emits every decoded packet straight onto the bus — no throttling at ingest. The client uses `requestAnimationFrame` to render, which decouples paint cadence from network jitter and lets the browser drop renders if the tab is hidden.

Capture and display share the same ~60 Hz rate. The earlier 30 Hz throttle was removed — bandwidth on LAN is free, and the temporal resolution matters for transient analysis and replay smoothness. See §8.9 decision 14 for the rationale.

---

## 4. First view: Suspension + Tire Corner

A top-down stylized car silhouette filling most of the screen. Each of the four corners has a panel attached, showing:

```
       ┌───────────────────────────┐    ┌───────────────────────────┐
       │ FRONT LEFT                │    │ FRONT RIGHT               │
       │ ┌─────────────┐           │    │           ┌─────────────┐ │
       │ │█████░░░░░░░░│ susp 0.42 │    │ susp 0.38 │█████░░░░░░░░│ │
       │ └─────────────┘           │    │           └─────────────┘ │
       │ slip R  0.06              │    │              slip R  0.04 │
       │ slip A  0.11              │    │              slip A  0.13 │
       │ temp    192 °F  ▓▓▓░     │    │     ▓▓▓▓   194 °F  temp   │
       │ ⊙ rumble                  │    │                  rumble ⊙ │
       └───────────────────────────┘    └───────────────────────────┘
                          ┌──────────────────┐
                          │   car silhouette │
                          │    (top-down)    │
                          │  speed: 142 km/h │
                          │  gear: 4         │
                          │  RPM: 6420 / 8000│
                          └──────────────────┘
       ┌───────────────────────────┐    ┌───────────────────────────┐
       │ REAR LEFT                 │    │ REAR RIGHT                │
       │   …same fields…           │    │   …same fields…           │
       └───────────────────────────┘    └───────────────────────────┘
```

### Visual encoding

- **Suspension bar**: horizontal SVG `<rect>` width = `normalizedTravel * 100%`. Color shifts green→yellow→red as it approaches 1.0. **Bottoming flash**: at travel > 0.95, the bar flashes for 200 ms. (Tuner's eye should be drawn to bottoming events.)
- **Slip ratio / angle**: numeric, with a small horizontal bar; positive=blue, negative=orange. Threshold marker at ±0.1.
- **Tire temp**: numeric °C (toggleable °F). Background color is a heatmap: cold blue → optimal green → hot red. Optimal target is roughly 80–95 °C — we'll let the user adjust this band per tire compound later.
- **Rumble indicator**: small dot, lights when `wheelOnRumbleStrip > 0`.
- **Center panel**: speed, gear, RPM bar (linear, not radial, so a glance reveals headroom against max).

### Why this view first

Suspension + tire corner data is what tuners stare at. One screen tells you:
- if the car bottoms out (rebound/bumpstop/spring rate),
- if the camber is wrong (temp gradient across the contact patch — well, Forza only gives one temp per tire, so we use L/R balance instead),
- if the diff is letting one rear wheel spin under power (slip ratio asymmetry),
- if you've got a brake-bias problem (slip ratio front-vs-rear under braking).

The "feels cool" RPM/boost dashboard is fun but doesn't change a setup decision.

---

## 5. Roadmap

Status markers (last reviewed 2026-05-20):
- **[done]** — implemented on `main`
- **[partial]** — server/data path in place, UI work outstanding
- **[todo]** — not started

### v1 — Corner view (this design doc) — **[done]** · commit `a42fced`
- UDP listener, decoder, WS fan-out
- Single-page corner view (now at `/live`)
- Connection indicator + "waiting for telemetry" empty state

### v2 — Input + chassis traces — **[done]** · commit `03355d3`
- Scrolling time-series strip below the corner view
- Lines: throttle (green), brake (red), steering (yellow), yaw rate (blue)
- 10-second sliding window (600 samples @ 60 Hz)
- Pause/scrub for post-corner analysis

### v3 — Event-scoped session recorder — **[done]** · commits `7002666` (core) + slice-4 polish
- User-defined events, scoped by FH5 event type (rally / race / street race / cross country / drag / freeroam)
- Manual Start/Stop recording from the dashboard (no auto-detect on `IsRaceOn`)
- Persistent storage in drizzle + libsql: `events`, `cars`, `sessions`, `laps` (gzipped frames blob per lap)
- PI-shift tune-label flow end-to-end: server emits `tune_prompt`, layout-mounted modal collects the name with datalist autocomplete from prior tunes; inline editor on session-detail page lets you set/change the label any time via `PATCH /api/sessions/:id`.
- Pages: `/events` → 6 type tiles → event detail with leaderboard + Start button; `/live` keeps the corner view. Global "Quick record" pill in the navbar opens a type → event → tune → Start modal from any page.
- `/events/:type` rows show best-lap-of-event and last-driven (relative) per row.
- Replay any captured lap by re-driving the corner view + trace strip from its frames blob.
- Lap-timing fallback for sessions that never tick `LapNumber` (§8.7) is **[done]** (2026-05-20, refined 2026-05-23). Originally observed with a touge run that finished with 0 captured laps. Refined in response to issue #5: FH6 has point-to-point routes under the `race` and `street_race` classes too, and `event.type` alone can't distinguish them from multi-lap races. Fallback in `server/utils/recorder.ts` now runs for **every** event type — if `stop()` fires with `lapsCompleted === 0` and a non-trivial buffer, the buffered frames flush as one lap (time = last.timestampMs − first.timestampMs). Multi-lap sessions still land on the LapNumber-transition path since the fallback only fires when no laps ticked.
- **Full spec in §8**

### Rate bump — full 60 Hz, no throttle — **[done]** · commit `ebe82f3`
- See §8.9 decision 14. Trace strip resized to 600 samples; recorder + WS both flow at native Forza rate.

### v4 — Tuning workbench — **[partial]**
Sliced. Slice 1 (two-lap overlay) shipped; track map, sector deltas, and per-lap diagnostics still **[todo]**.

- Overlay traces from two captured laps (same event, different car/tune) — **[done]** · slice 1
  - Leaderboard checkbox column on `/events/:type/:id`; "Compare →" pill appears when two sessions are selected
  - New page `/events/:type/:id/compare?a=&b=` overlays throttle / brake / steer by distance with a sign-clipped delta-time line (B − A)
  - `app/utils/align.ts` resamples both laps onto a shared 1-meter distance grid; `formatDelta` added to `app/utils/format.ts`
- Per-sector deltas, sector boundaries derived from distance along the route — **[todo]** · slice 3
- "Bottoming events" list — every frame where `normalizedTravel > 0.95`, with the speed / steering at that frame — **[todo]** · slice 4
- Tire-temp histogram per lap — **[todo]** · slice 4
- Track map: plot `(PositionX, PositionZ)` colored by current speed — **[todo]** · slice 2
- Decodes the v3 frames blobs on demand for analytics — **[done]** · slice 1 reuses `GET /api/laps/:id/frames` (extended to also return session/car/tune metadata)

### v5 (maybe) — Hardware shift light — **[todo]**
- Tiny serial bridge from the Nitro server to a USB-attached RP2040 or Arduino
- LEDs map to `currentRpm / engineMaxRpm`
- Stays optional; the screen view should never depend on hardware

---

## 6. Decisions (resolved 2026-05-19)

1. **Units**: **metric** — km/h + °C. Decoder converts speed from m/s and tire temp from °F internally; UI only ever shows the metric values.
2. **Forza port**: **5300 default**, overridable via `FORZA_PORT` env var. Lets the tool coexist with other telemetry consumers on the same LAN.
3. **Network setup**: **LAN** — Forza on PC/Xbox, Nuxt on a separate home server (`mainframe.bass-salak`). Server binds `0.0.0.0`; in-game Data Out IP = server's LAN IP; UDP 5300 must be open in the server's firewall. README documents how to find the LAN IP and add the firewall rule.
4. **Theme**: **dark only**. No toggle, no system auto-detect. Background `#09090b` (zinc-950), panels `#18181b/80` (zinc-900 with 80% alpha), text `#fafafa`, accents per the heatmap palette.
5. **Tire-temp band**: cold <80 °C, optimal 80–95 °C, hot >95 °C. Hardcoded as constants in `~/utils/tuning-constants.ts` for v1; settings panel arrives in v2 alongside the trace strip.
6. **Race-off behavior**: when `isRaceOn = 0`, **freeze the last live frame** and overlay a translucent `PAUSED` band across the screen. Lets you read post-crash state during the menu pause. Reconnection/initial-load shows a different "WAITING FOR TELEMETRY" empty state (no frozen frame yet).

---

## 7. Key code sketches

These are the **v1-era** load-bearing pieces — just the shape of each. The actual code has evolved (no throttle, recorder + start/stop in the WS handler, typed bus events). Consult the source files for the current shape; treat this section as historical context for how v1 was built.

### Decoder (`server/utils/decode.ts`)

```ts
export interface Telemetry {
  isRaceOn: boolean
  timestampMs: number
  rpm: number
  rpmMax: number
  rpmIdle: number
  speedKmh: number
  gear: number
  throttle: number   // 0..1
  brake: number      // 0..1
  steer: number      // -1..1
  power: number
  torque: number
  boost: number
  suspension: { fl: number; fr: number; rl: number; rr: number } // normalized 0..1
  slipRatio:  { fl: number; fr: number; rl: number; rr: number }
  slipAngle:  { fl: number; fr: number; rl: number; rr: number }
  tireTempC:  { fl: number; fr: number; rl: number; rr: number }
  rumble:     { fl: boolean; fr: boolean; rl: boolean; rr: boolean }
  lap: { number: number; current: number; last: number; best: number }
}

const fToC = (f: number) => (f - 32) * 5 / 9

export function decodeCarDash(buf: Buffer): Telemetry | null {
  if (buf.length < 324) return null

  const f32 = (o: number) => buf.readFloatLE(o)
  const u8  = (o: number) => buf.readUInt8(o)
  const s8  = (o: number) => buf.readInt8(o)
  const s32 = (o: number) => buf.readInt32LE(o)
  const u16 = (o: number) => buf.readUInt16LE(o)
  const u32 = (o: number) => buf.readUInt32LE(o)
  const quad = (o: number) => ({
    fl: f32(o), fr: f32(o + 4), rl: f32(o + 8), rr: f32(o + 12),
  })

  return {
    isRaceOn: s32(0) === 1,
    timestampMs: u32(4),
    rpmMax: f32(8),
    rpmIdle: f32(12),
    rpm: f32(16),
    suspension: quad(68),
    slipRatio:  quad(84),
    slipAngle:  quad(164),
    tireTempC: {
      fl: fToC(f32(268)), fr: fToC(f32(272)),
      rl: fToC(f32(276)), rr: fToC(f32(280)),
    },
    rumble: {
      fl: f32(116) > 0, fr: f32(120) > 0,
      rl: f32(124) > 0, rr: f32(128) > 0,
    },
    speedKmh: f32(256) * 3.6,
    power: f32(260),
    torque: f32(264),
    boost: f32(284),
    throttle: u8(315) / 255,
    brake:    u8(316) / 255,
    steer:    s8(320) / 127,
    gear:     u8(319),
    lap: {
      number:  u16(312),
      current: f32(304),
      last:    f32(300),
      best:    f32(296),
    },
  }
}
```

### Event bus (`server/utils/forza-bus.ts`)

```ts
import { EventEmitter } from 'node:events'
import type { Telemetry } from './decode'

class ForzaBus extends EventEmitter {
  declare emit: (event: 'telemetry', t: Telemetry) => boolean
  declare on:   (event: 'telemetry', listener: (t: Telemetry) => void) => this
  declare off:  (event: 'telemetry', listener: (t: Telemetry) => void) => this
}

export const forzaBus = new ForzaBus()
forzaBus.setMaxListeners(50) // raise ceiling for many tabs
```

### UDP listener plugin (`server/plugins/forza-listener.ts`)

```ts
import dgram from 'node:dgram'
import { decodeCarDash } from '../utils/decode'
import { forzaBus } from '../utils/forza-bus'

export default defineNitroPlugin(() => {
  const port = Number(process.env.FORZA_PORT ?? 5300)
  const bind = process.env.FORZA_BIND ?? '0.0.0.0'

  const sock = dgram.createSocket('udp4')

  // Throttle: send every other packet (~30 Hz).
  let frame = 0

  sock.on('message', (buf) => {
    const t = decodeCarDash(buf)
    if (!t || !t.isRaceOn) return
    if ((frame++ & 1) === 0) forzaBus.emit('telemetry', t)
  })

  sock.on('error', (err) => console.error('[forza] socket error', err))

  sock.bind(port, bind, () => {
    console.log(`[forza] listening on udp://${bind}:${port}`)
  })
})
```

### WS fan-out (`server/routes/_ws.ts`)

```ts
import { defineWebSocketHandler } from 'h3'
import { forzaBus } from '../utils/forza-bus'
import type { Telemetry } from '../utils/decode'

export default defineWebSocketHandler({
  open(peer) {
    const onTelemetry = (t: Telemetry) => peer.send(JSON.stringify(t))
    forzaBus.on('telemetry', onTelemetry)
    ;(peer as any)._onTelemetry = onTelemetry
  },
  close(peer) {
    const fn = (peer as any)._onTelemetry
    if (fn) forzaBus.off('telemetry', fn)
  },
})
```

### Nuxt config bits (`nuxt.config.ts`)

```ts
export default defineNuxtConfig({
  nitro: {
    experimental: { websocket: true },
  },
  // ...
})
```

### Client composable (`composables/useTelemetry.ts`)

```ts
import type { Telemetry } from '~/server/utils/decode'

export function useTelemetry() {
  const telemetry = ref<Telemetry | null>(null)
  const connected = ref(false)

  onMounted(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_ws`
    const ws = new WebSocket(url)
    ws.onopen  = () => (connected.value = true)
    ws.onclose = () => (connected.value = false)
    ws.onmessage = (e) => (telemetry.value = JSON.parse(e.data))
    onBeforeUnmount(() => ws.close())
  })

  return { telemetry, connected }
}
```

### Corner panel (`components/CornerPanel.vue`) — shape only

```vue
<script setup lang="ts">
const props = defineProps<{
  label: string
  suspension: number  // 0..1
  slipRatio: number
  slipAngle: number
  tempC: number
  rumble: boolean
}>()

const bottoming = computed(() => props.suspension > 0.95)
const suspColor = computed(() => {
  if (props.suspension > 0.95) return '#ef4444'
  if (props.suspension > 0.80) return '#f59e0b'
  return '#22c55e'
})
const tempColor = computed(() => {
  const c = props.tempC
  if (c < 60)  return '#3b82f6'
  if (c < 80)  return '#14b8a6'
  if (c < 95)  return '#22c55e'
  if (c < 110) return '#f59e0b'
  return '#ef4444'
})
</script>

<template>
  <div class="rounded-lg bg-zinc-900/80 p-4 text-zinc-100 font-mono">
    <div class="text-xs uppercase tracking-wider text-zinc-400">{{ label }}</div>

    <svg viewBox="0 0 100 8" class="mt-2 w-full">
      <rect x="0" y="0" width="100" height="8" rx="2" fill="#27272a" />
      <rect x="0" y="0" :width="suspension * 100" height="8" rx="2" :fill="suspColor"
            :class="{ 'animate-pulse': bottoming }" />
    </svg>
    <div class="mt-1 text-xs">susp {{ suspension.toFixed(2) }}</div>

    <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
      <div>slip R<br><span class="text-base">{{ slipRatio.toFixed(2) }}</span></div>
      <div>slip A<br><span class="text-base">{{ slipAngle.toFixed(2) }}</span></div>
    </div>

    <div class="mt-3 flex items-center gap-2">
      <span class="inline-block h-3 w-3 rounded-sm" :style="{ background: tempColor }" />
      <span class="text-sm">{{ tempC.toFixed(0) }} °C</span>
      <span v-if="rumble" class="ml-auto text-xs text-amber-400">⊙ rumble</span>
    </div>
  </div>
</template>
```

---

## 8. v3 — Event-scoped session recorder

The lap recorder builds on the v1/v2 live view by adding **structured, queryable persistence** so you can: see best lap per event, group laps by car or tune, validate tuning changes against prior runs, and replay any saved lap by re-driving the existing corner view + trace strip.

Locked in 2026-05-19 — what follows is the agreed shape, not a wish list.

### 8.1 Goals

- **Validate tunes.** Run an event, change a car's tune, run it again, compare lap times and traces on the same event. The tuning feedback loop is the whole point of the tool; the recorder closes it.
- **Group by event.** "Best time on Goliath", "best time on this rally route" — a leaderboard scoped to a named user-defined event.
- **Group by car.** Per-car history across events and tunes.
- **Free-roam recordings, too.** Open-world test drives ("Highway A test", "Mulege coastal run") use the same machinery; they live under the `freeroam` event type, where lap times are inherently looser.

Explicitly *not* in v3: live deltas against best lap (deferred), automatic sector detection (v4), or coaching overlays (won't build, see §9).

### 8.2 Data model — **[done]**

Stored in **drizzle + libsql** via `@nuxthub/db`. Schema in `server/db/schema.ts`; migrations generated via `npx nuxt db generate` and applied with `npx nuxt db migrate` (per `CLAUDE.md`). No hand-written SQL.

```ts
// shape only — the real definitions live in server/db/schema.ts
export const eventType = ['rally','race','street_race','cross_country','drag','freeroam'] as const

export const events = sqliteTable('events', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  name:      text('name').notNull(),
  type:      text('type', { enum: eventType }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, t => ({
  unqNameType: uniqueIndex('events_name_type_unq').on(t.name, t.type),
}))

export const cars = sqliteTable('cars', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  ordinal:     integer('ordinal').notNull().unique(),   // CarOrdinal from the packet
  class:       integer('class').notNull(),              // CarClass 0..7
  displayName: text('display_name'),                    // user-editable; null → "#<ordinal>"
})

export const sessions = sqliteTable('sessions', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  eventId:   integer('event_id').notNull().references(() => events.id),
  carId:     integer('car_id').notNull().references(() => cars.id),
  tuneLabel: text('tune_label'),                        // null until user names the tune
  piAtStart: integer('pi_at_start').notNull(),          // CarPerformanceIndex snapshot
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt:   integer('ended_at',   { mode: 'timestamp' }),
})

export const laps = sqliteTable('laps', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  sessionId:  integer('session_id').notNull().references(() => sessions.id),
  lapNumber:  integer('lap_number').notNull(),
  timeMs:     integer('time_ms').notNull(),
  framesBlob: blob('frames_blob').notNull(),            // gzipped JSON — see §8.6
})
```

### 8.3 Recording state machine — server-owned — **[done]**

The UDP listener already lives server-side and recording must survive a browser refresh, so the recorder lives in Nitro too. The browser only sends commands and renders state.

```
       start{event_id, tune_label?}             stop
IDLE ─────────────────────────────────► RECORDING ─────► IDLE
                                              │
                                  LapNumber  │
                                  change     │
                                  ▼          │
                       flush buffered frames │
                       → new laps row,       │
                       reset frame buffer    │
```

- **IDLE → RECORDING:** open a `sessions` row with `pi_at_start` from the latest telemetry; insert the car if new (key on `ordinal`). Begin buffering decoded frames in memory.
- **LapNumber change while RECORDING:** flush the frame buffer as the just-completed lap (`laps` row with `time_ms = LastLap` from the new packet, frames gzipped into `frames_blob`). Reset the buffer.
- **RECORDING → IDLE (Stop):** **discard the partial lap** (any frames since the last `LapNumber` tick). Finalize the session row with `ended_at`. If `pi_at_start` differs from this car's previous session, queue a `tune_prompt`.

### 8.4 WS protocol additions — **[done]**

The existing outbound `telemetry` stream is unchanged.

> Implementation note: the wire discriminator field is **`type`**, not `kind` as originally drafted here — `type` was the existing convention in the v1 WS handler (`{ type: 'hello' }`, `{ type: 'telemetry', t }`) and the new messages match it. The shapes below have been updated.

New inbound:
```ts
{ type: 'start', eventId: number, tuneLabel?: string | null }
{ type: 'stop' }
```

New outbound:
```ts
{ type: 'recording_state', state: 'idle' } |
{ type: 'recording_state', state: 'recording', sessionId: number, eventId: number,
                           carOrdinal: number, lapsCompleted: number } |
{ type: 'tune_prompt', sessionId: number, carOrdinal: number,
                       previousPi: number, currentPi: number } |
{ type: 'error', message: string }
```

`recording_state` is broadcast on every transition so multiple tabs stay in sync. `tune_prompt` fires once when a session ends with a PI shift; any tab can answer it. `error` is sent back to the originating peer when a `start` fails (e.g. unknown event id, no telemetry yet).

### 8.5 Navigation — **[done]**

```
/                     → 302 redirect to /live   (implementation diverges from the original spec, see note)
/live                 → the v1+v2 corner view + trace strip (the "second screen")
                        Shows a small "● REC" badge when state=recording, plus a Stop button.
/events               → six type tiles (rally / race / street race / cross country / drag / freeroam)
                        with event counts.
/events/:type         → list of events of that type with inline "New event" entry.
                        Each row shows best-lap-of-event and a relative last-driven timestamp.
/events/:type/:id     → event detail:
                          • leaderboard (best lap per session, joined with car + tune + PI)
                          • "Start Recording" button (event pre-selected; navigates to /live)
/events/:type/:id/:sessionId
                      → session detail: metadata header (with inline tune-label editor) +
                        lap table with per-lap "▶ Replay".
                        Replay mounts ReplayPlayer driven by the lap's frames_blob.
```

> Spec divergence: the original navigation block had `/` redirecting to `/events`. During slice-2 review the user pushed back — "the home screen redirects to /events so there is no active dash anymore" — so `/` now lands the user on the dashboard. The events browser remains at `/events`, reachable via the navbar.

"Quick record" is a modal version of the event picker, available from any page via a pill in the navbar — for when the user is already on `/live` and doesn't want to navigate back. The pill is hidden while a recording is active (the REC badge with Stop button is shown in its place).

The default Nuxt layout owns the navbar across every page: brand → Live/Events nav (with active states), Quick-record pill (when idle), persistent REC badge with Stop (when recording), WS status indicator, live T+timestamp when telemetry is flowing.

### 8.6 Frame storage — per-lap blob — **[done]**

A 2-minute lap at 60 Hz is ~7200 frames (~720 KB gzipped per lap). Storing them as rows would explode row counts across many sessions without buying any query power — frames are only ever read back as a whole for replay.

So: **one gzipped blob per `laps` row**. Encoded as a JSON array of decoded `Telemetry` objects, gzipped at lap finalization, written once. Replay decompresses and streams the array at the original timestamps. v4 analytics (bottoming events, slip histograms) decode the blob on demand.

Display and capture share the same ~60 Hz cadence — see §8.9 decision 14.

### 8.7 Lap timing — trust the in-game signal — **[done]**

When `LapNumber` advances, the new packet's `LastLap` field holds the just-completed lap time in seconds. Convert to ms, store. Same code path for **all event types** — circuits, drags, rallies, free roam.

**Confirmed empirically (2026-05-20):** FH6 doesn't tick `LapNumber` for `touge / rally / drag / cross_country / freeroam`. **Refined (2026-05-23, issue #5):** the same holds for point-to-point routes under the `race` and `street_race` classes — and there's no way to tell those apart from multi-lap races by `event.type` alone. The fallback now runs for every event type: when `stop()` is called with `lapsCompleted === 0` and at least 2 buffered frames, the whole buffer flushes as a single lap with `time_ms = last.timestampMs - first.timestampMs` (game time, not walltime, so paused frames don't bloat it). Multi-lap sessions naturally bypass this — the LapNumber-transition path increments `lapsCompleted` and the fallback condition becomes false.

**Race-state gating (2026-05-20, refined 2026-05-22):** the recorder ignores any frame where `isRaceOn === false`, so loading screens / countdowns / menu pauses never end up in the buffer (previously inflated touge runs by ~20 seconds of zero-data frames). Additionally, `isRaceOn=false` CLEARS the buffer *only while no run-started signal has fired yet* (no LapNumber tick AND fewer than ~2 s of frames). That gates pre-event garbage — pressing Record in freeroam and then driving into an event entrance gets the freeroam frames discarded at the loading screen — without losing a completed run when the finish-line UI flips `isRaceOn` off (the run-started guard preserves the buffer through that). Applies uniformly to all event types as of 2026-05-23 (issue #5).

**Opening-lap capture (2026-06-01):** the LapNumber-transition path used to *unconditionally discard* the first transition after `start()`, assuming recording always began mid-lap. But the normal workflow is to press Record during the pre-race pause and then resume — so the opening lap runs from the grid and is fully captured. Discarding it dropped a real lap and shifted the recorded lap list relative to the in-game one. The recorder now decides keep-vs-discard per lap from `CurrentLap` on the first buffered frame of that lap: `< 2 s` means the lap clock just reset (caught from the start → keep at the next tick), a larger value means a genuine mid-lap join (discard). This is *not* wired into the run-started buffer-clear guard above — doing so would defeat the freeroam-garbage drop, since freeroam frames can also read `CurrentLap ≈ 0`. Pause/resume mid-race still never ends a recording; only an explicit Stop does (§8.3).

### 8.8 Tune-label flow — **[done]**

`CarPerformanceIndex` is in the packet; the tune label is not. So:

1. At session start, snapshot `pi_at_start`. — **[done]** in `server/utils/recorder.ts`.
2. On session end, compare to the most recent prior session for the same `car_id`. If different, emit `tune_prompt`. — **[done]** server-side; client receives and stores the prompt in `useRecording().tunePrompt`.
3. UI shows a non-blocking modal: "PI went 745 → 758 — did you re-tune? Name this tune:" with a text input + autocomplete from prior tune labels for this car. — **[done]** in `TunePromptModal.vue`, mounted in the default layout; autocomplete is sourced from `GET /api/cars/:ordinal/tunes`.
4. `tune_label` is editable from any session detail page at any time. — **[done]** via the inline click-to-edit cell in `pages/events/[type]/[id]/[sessionId].vue`, which calls `PATCH /api/sessions/:id`.

PI shift is a *signal*, not a guarantee — the user might tune without changing PI (within the same class) or change PI without considering it a new tune. Manual override is always available.

### 8.9 Decisions (resolved 2026-05-19)

Continuing the §6 list:

7. **Persistence**: drizzle + libsql via `@nuxthub/db`, not the file-per-lap JSON sketched in the original §5 v3 entry. The relational queries this enables — best lap per event, tune A vs tune B on the same car — are the whole point of the feature.
8. **Recording trigger**: **manual Start/Stop** from the dashboard, not auto-detection on `IsRaceOn` edges. The user is at the second screen anyway; explicit control kills false triggers from Test Drive, photo mode, and menu transitions.
9. **Partial laps**: discarded. Only laps where `LapNumber` actually advanced (or the type-specific fallback fires) count. A partial can't be a best, and including them muddies leaderboards.
10. **Event names**: combobox — pick existing or create new — scoped within a type. `(name, type)` is unique, so "Goliath" as a race and "Goliath" as a free-roam recording are distinct events.
11. **Tune tracking**: PI-shift auto-prompt with manual override at any time. Free signal, catches forgotten labels, never blocks.
12. **Frame storage**: one gzipped blob per `laps` row, not per-frame rows.
13. **`/live` stays**: the existing corner view + trace strip remains the primary "while driving" view; v3 only adds a small REC badge. No new components on `/live`.
14. **Sample rate — full 60 Hz, no throttle**: capture and display both run at the native Forza Data Out rate. The previous 30 Hz throttle was a WAN-era bandwidth defence that's irrelevant on LAN; the temporal resolution gain matters for replay smoothness and transient analytics (brake-lockup onset, wheelspin spikes, bottoming events span 50–200 ms, where 30 Hz aliases the shape). Storage delta is trivial (~720 KB per 2-min lap gzipped). User's stated principle: gather everything, decide later whether to use it.
15. **Deletion is user-driven for events + sessions**: `DELETE /api/events/:id` and `DELETE /api/sessions/:id`. Manual cascade inside a `db.transaction` (laps → sessions → event for the event handler; laps → session for the session handler) — FKs stay at SQLite's NO ACTION default so no schema migration is required, and the cascade is auditable in code. Laps are not directly deletable; remove the parent session to drop a bad lap. Cars are never deleted by the user — orphaned car rows are kept so `displayName` survives across re-recordings of the same ordinal. **Active-recording guard**: the API returns 409 if the targeted event/session is the one currently being recorded; the user must stop the recording first (no auto-stop, no hidden side effects). Surface in the UI by a reusable `ConfirmModal.vue` mounted on event-detail and session-detail pages, with a red pill button and a cascade-count message ("3 sessions and 17 laps will be removed").

---

## 9. What I won't build

- A Forza Motorsport mode. FM uses the same Sled but a slightly different Dash layout (no 12-byte gap). Easy to add later by branching the decoder on packet length.
- Cloud sync of sessions. Sessions stay on disk. If you want them off-box, that's `rsync`'s job.
- A login / multi-user mode. The whole thing lives on your network. If you want to lock the port down, that's a firewall rule, not a feature.
- "Driver coaching" overlays / lap suggestion AI. Out of scope; we want a tool, not a coach.

---

## 10. Where things stand (epilogue, 2026-05-20)

v1–v3 shipped exactly as planned. v4 outpaced the roadmap: the lap-overlay
slice landed as designed, then a bunch of work the original plan didn't
anticipate also shipped — friction circle per corner, G-G dot, diagnostic
chips, motor trace strip, DVR scrub, `/tune` reference, `/dyno` gear-tuning
workbench, lap-replay player, the `touge` event type, and a few smaller
pieces (debug panel, confirm/tune modals, delete cascades). The roadmap
markers in §5 are stale on purpose — that section is the original plan, not
the current state. See `git log` for the actual delivery story.

Items from §5 that didn't ship and survive as **standalone wishlist**, not
roadmap commitments:

- Track map (`PositionX, PositionZ` colored by speed) — v4 slice 2
- Per-sector deltas / sector boundary detection — v4 slice 3
- Bottoming events list + tire-temp histogram — v4 slice 4
- Hardware shift light (USB serial bridge to RP2040 / Arduino) — v5

None of the §9 won't-build items crept in.

The decoder (§2 + §7) and the architectural decisions (§6, §8.9) are still
authoritative for anything touching the UDP layer or the recorder. Treat
the rest of this document as historical.
