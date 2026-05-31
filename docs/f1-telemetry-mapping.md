# F1 (F1 25 / F1 26) → `Telemetry` data-model diff

Working note for the F1 adapter (issue #16). Compares the EA/Codemasters F1 UDP feed
against our canonical `Telemetry` (`server/utils/decode.ts`) so the mapping, the unit
conversions, and the required model changes are settled **before** writing `server/adapters/f1.ts`.

Reference for our model: `server/utils/decode.ts`. Reference for the wire format: the official
"F1 25 UDP specification" (and the bundled "2026 Season Pack" structures) on the EA forums.
Field details below are from the F1 25 spec; treat anything marked **(verify)** as needing a
confirmation pass against the spec PDF / a live capture before relying on it.

---

## 1. The big structural difference

Forza hands us **one self-contained 324-byte packet** per frame → one `decode(buf)` call yields a
full `Telemetry`. **F1 does not.** A single logical frame is spread across several packet types,
each with its own `m_packetId`, arriving at different rates:

| `m_packetId` | Packet | Carries (for us) |
|---|---|---|
| 0 | Motion | world position, world velocity, g-forces, yaw/pitch/roll (all cars) |
| 1 | Session | session/track state → used to derive `isRaceOn` |
| 2 | Lap Data | lap number, position, current/last lap time, lap + total distance |
| 4 | Participants | team/driver id (best we get for car identity) |
| 6 | Car Telemetry | speed, rpm, throttle/brake/clutch, gear, tyre/brake temps, tyre pressure |
| 7 | Car Status | maxRPM, idleRPM, fuel, tyre compound, ERS |
| 11 | Session History | **best lap time** (not in Lap Data!) |
| 13 | Motion Ex | suspension, wheel slip ratio/angle, wheel speed, angular velocity (player only) |

**Adapter shape:** the F1 adapter is **stateful**. It keeps the latest of each relevant packet
(keyed by nothing — we only care about the player car), and emits a merged `Telemetry` on the
high-rate tick — **Car Telemetry (id 6)** is the natural trigger (~the physics rate). Player car is
selected with `PacketHeader.m_playerCarIndex` into every per-car array.

This breaks the current `decode(buf: Buffer): Telemetry | null` contract, which assumes one packet =
one frame. See §6.

---

## 2. Cross-cutting gotchas (apply to every per-wheel + input field)

- **Wheel array order differs.** F1 arrays are `[RL, RR, FL, FR]` (index 0=RL, 1=RR, 2=FL, 3=FR).
  Our `Quad` is `{ fl, fr, rl, rr }`. Every per-wheel map must reindex:
  `fl = arr[2], fr = arr[3], rl = arr[0], rr = arr[1]`.
- **Inputs already normalized.** F1 `m_throttle/m_brake/m_steer` are floats `0..1` / `-1..1` — no
  `/255` or `/127` like Forza. `m_clutch` is `uint8 0..100` → `/100`.
- **Speed already km/h.** F1 `m_speed` is `uint16` km/h → assign directly (Forza was m/s × 3.6).
- **Angles in radians** (yaw/pitch/roll) — same as Forza, no conversion.
- **No °F→°C.** F1 temps are already Celsius (Forza was Fahrenheit).
- **Gear encoding differs.** F1 `m_gear` is `int8`: `-1`=R, `0`=N, `1..8`=gears. Forza used
  `0`=reverse. Decide one convention for `Telemetry.gear` and document (see §6).

---

## 3. Field-by-field mapping

`Telemetry` field ← F1 source (`Packet.field`). "—" = no F1 source.

### State / engine
| `Telemetry` | F1 source | Conversion / note |
|---|---|---|
| `isRaceOn` | Session (derived) | No direct "race on" bit. Derive (paused/in-menu heuristic) — see §6. |
| `timestampMs` | `PacketHeader.m_sessionTime` (float s) | `× 1000`. Or use our own receive clock. |
| `rpm` | `CarTelemetry.m_engineRPM` (uint16) | direct |
| `rpmMax` | `CarStatus.m_maxRPM` (uint16) | direct |
| `rpmIdle` | `CarStatus.m_idleRPM` (uint16) | direct |
| `speedKmh` | `CarTelemetry.m_speed` (uint16 km/h) | direct |
| `power` | `CarStatus.m_engine_power_ice + m_engine_power_mguk` | **F1 25 added these** — summed (assumed Watts, to match Forza; **verify units**) |
| `torque` | — | **no F1 channel** → `null` (see §5) |
| `boost` | — | F1 has no turbo-boost gauge channel → `null` (see §5) |

### Inputs
| `Telemetry` | F1 source | Conversion |
|---|---|---|
| `gear` | `CarTelemetry.m_gear` (int8) | encoding decision (§6) |
| `throttle` | `CarTelemetry.m_throttle` (float 0..1) | direct |
| `brake` | `CarTelemetry.m_brake` (float 0..1) | direct |
| `clutch` | `CarTelemetry.m_clutch` (uint8 0..100) | `/100` |
| `handBrake` | — | no F1 channel → `0` |
| `steer` | `CarTelemetry.m_steer` (float -1..1) | direct |
| `drivingLine` | — | Forza-only → `null` (already nullable) |
| `aiBrakeDifference` | — | Forza-only → `null` (already nullable) |

### Per-wheel (remember `[RL,RR,FL,FR]` → `{fl,fr,rl,rr}`)
| `Telemetry` | F1 source | Conversion / note |
|---|---|---|
| `suspension` (0..1) | — | F1 has no normalized travel → leave `0`/derive; no clean source |
| `suspensionMeters` | `MotionEx.m_suspensionPosition[4]` | **(verify units** — raw position, likely not meters) |
| `slipRatio` | `MotionEx.m_wheelSlipRatio[4]` | direct |
| `slipAngle` | `MotionEx.m_wheelSlipAngle[4]` | direct (radians) |
| `combinedSlip` | derived | `sqrt(slipRatio² + slipAngle²)` per wheel |
| `tireTempC` | `CarTelemetry.m_tyresSurfaceTemperature[4]` (uint8 °C) | direct; inner temp also available |
| `wheelRotation` | `MotionEx.m_wheelSpeed[4]` | **(verify units** — F1 "wheel speed" vs our rad/s) |
| `rumble` | `CarTelemetry.m_surfaceType[4]` (derive) | could flag rumble-strip surface; else `null` |
| `puddle` | — | → `null` (already nullable) |

### Orientation / motion
| `Telemetry` | F1 source | Conversion / note |
|---|---|---|
| `yaw` / `pitch` / `roll` | `Motion.m_yaw/m_pitch/m_roll` (rad) | direct |
| `position` | `Motion.m_worldPositionX/Y/Z` (float) | direct |
| `velocity` | `Motion.m_worldVelocityX/Y/Z` (float) | direct (world frame) |
| `acceleration` | `Motion.m_gForceLateral/Longitudinal/Vertical` | **g, not m/s²** → `× 9.81` to approximate, or accept g. No true linear-accel channel. |
| `angularVelocity` | `MotionEx.m_angularVelocityX/Y/Z` (float) | direct |

### Car identity
| `Telemetry.car` | F1 source | Note |
|---|---|---|
| `ordinal` | — | no equivalent → `0`/null (§5) |
| `class` | — | no PI class → `0`/null |
| `pi` | — | no Performance Index in F1 → `0`/null |
| `drivetrain` | — | always RWD in F1, but no field → `0`/null |
| `cylinders` | — | no field → `0`/null |

Closest identity F1 offers: `Participants.m_teamId` / `m_driverId` (enums, not numeric PI). Could map
to a label later; numeric `car.*` stays empty.

### Lap / race
| `Telemetry.lap` | F1 source | Conversion / note |
|---|---|---|
| `number` | `LapData.m_currentLapNum` (uint8) | direct |
| `racePosition` | `LapData.m_carPosition` (uint8) | direct |
| `current` | `LapData.m_currentLapTimeInMS` | `/1000` → seconds |
| `last` | `LapData.m_lastLapTimeInMS` | `/1000` → seconds |
| `best` | `SessionHistory` best lap | **not in Lap Data** — pull from Session History packet (id 11) or derive from observed laps |
| `raceTime` | `PacketHeader.m_sessionTime` | seconds |
| `distance` | `LapData.m_totalDistance` (float m) | **use total (cumulative) distance** — matches FH6's cumulative-`lap.distance` semantic (see memory `project_fh6_lap_distance_cumulative`); `m_lapDistance` is per-lap |

### Misc
| `Telemetry` | F1 source | Conversion / note |
|---|---|---|
| `fuel` | `CarStatus.m_fuelInTank` (float kg) | F1 fuel is **kg absolute**, ours is 0..1 (FH6). Normalize `m_fuelInTank / m_fuelCapacity` → 0..1 |
| `rawLength` | — | set to combined/last packet length (diagnostic only) |

---

## 4. What F1 gives that we don't model (ignore for v1, candidates later)

DRS state, rev-lights %, brake temperatures (`m_brakesTemperature[4]`), tyre inner temps, tyre
pressures (`m_tyresPressure[4]`), engine temp, ERS store/deploy/harvest, tyre compound + age, fuel
mix, front brake bias, penalties/sector times, suspension velocity/acceleration, wheel lat/long
forces, g-force vertical. None block the adapter; note any we want to surface so the model grows
deliberately rather than ad hoc.

## 5. `Telemetry` model changes (nullability) — IMPLEMENTED

Per the per-field nullability rule (memory `feedback_defer_telemetry_nullability`):

- `power` → **stays `number`.** F1 25 *does* provide power (`m_engine_power_ice + m_engine_power_mguk`),
  so no flip needed. (The original draft assumed power was absent; the CarStatus struct proved otherwise.)
- `torque: number` → **flipped to `number | null`** (no F1 source).
- `boost: number` → **flipped to `number | null`** (no F1 boost gauge; boost native unit is PSI per
  `project_boost_native_unit_psi`, F1 simply has none). Forza adapters still always emit a number
  (0 for NA cars), so Forza behaviour is unchanged.
- `car: { ordinal, class, pi, drivetrain, cylinders }` → kept as `number`; F1 sets `0` sentinels
  except `drivetrain: 1` (RWD) and `cylinders: 6` (V6), both constant for the modern F1 field.
- `handBrake`, `suspension` (normalized) → `0` (absent in F1, not "missing").

Consumers guarded for the torque/boost flip (`?? 0`): `app/utils/tune-signals.ts`,
`app/utils/dyno.ts`, `app/composables/useTelemetry.ts`, `app/composables/useReplay.ts`,
`app/components/CornerView.vue`, and the codec round-trip test. The FZC1 codec needed no change:
`torque`/`boost` remain non-nullable f32 columns (0-coalescing), which is correct because F1 has
`tuning: false` and is never recorded — only Forza frames (always-present) reach the codec.

## 6. Open decisions (resolve before coding `f1.ts`)

1. **Adapter contract.** `decode(buf)` assumes 1 packet = 1 frame. F1 needs **stateful multi-packet
   assembly**. Options: (a) let the F1 adapter hold internal "latest packet" state and return a
   `Telemetry` only on the Car Telemetry tick (returning `null` for the other packet ids it consumes);
   (b) widen the adapter interface. (a) keeps `TelemetryAdapter` unchanged and is preferred.
2. **Per-year versioning.** Switch on `PacketHeader.m_packetFormat` (2025 vs 2026). Struct sizes shift
   between years; isolate offsets per format. F1 26's structures ship in the EA "2026 Season Pack".
3. **`isRaceOn` derivation.** No direct bit. Candidate: true while Session packet reports an active
   (non-paused, on-track) session and packets are flowing; matches our "unpaused = live" semantic
   (`project_is_race_on_semantic`). Needs a capture to confirm what F1 sends while paused.
4. **Gear encoding** for `Telemetry.gear` (keep F1's `-1=R/0=N`, or remap to Forza's `0=R`).
5. **Unit verifications:** `m_suspensionPosition` units, `m_wheelSpeed` units, whether to store
   `acceleration` as m/s² (×9.81 from g) or as raw g.
6. **Port + selection.** `transport.defaultPort = 20777`; F1 supports broadcast mode. Adapter
   selection still flows through `getActiveAdapter()` / `FORZA_GAME` until per-game selection lands.

---

## 7. Coverage summary

Maps cleanly: rpm/idle/max, speed, all inputs, steer, slip ratio/angle (+combined), tyre temp,
yaw/pitch/roll, position, velocity, angular velocity, lap number/position/current/last/distance,
fuel (normalized), **power** (ICE+MGU-K). Approximate: acceleration (from g-force),
wheelRotation/suspensionMeters (unit verify), `lap.best` (derived from min completed lap — Session
History would be authoritative). **Missing entirely** (Forza-only): torque, boost, car
PI/ordinal/class, drivingLine, aiBrakeDifference, handBrake, normalized suspension, puddle, rumble.

## 8. Status

Implemented: `server/adapters/f1.ts` (stateful multi-packet merge), registered in
`server/adapters/index.ts`, `'f1'` added to `shared/games.ts` (telemetry-only). Unit test:
`test/unit/f1-adapter.test.ts`. Typecheck + lint + unit suite green. **Not yet verified against a
live capture** — the open items in §6 (suspension/wheel-speed units, power units, isRaceOn
heuristic, F1 26 layout deltas) still need a real telemetry stream to confirm.
