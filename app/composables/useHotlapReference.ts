import { effectScope, type EffectScope } from 'vue'
import {
  buildLapReference,
  referenceClockAt,
  type LapReference,
  type LapReferenceSample
} from '~/utils/lap-reference'
import {
  emptySectorPBs,
  applyCompletedSectors,
  theoreticalLapMs as theoreticalLapMsFn,
  type SectorPBs
} from '~/utils/sector-pbs'
import { pointsFromFrames, type TrackPoint } from '~/utils/track-map'
import type { Telemetry } from '../../server/utils/decode'

interface PBLapResponse {
  lapId: number
  lapNumber: number
  timeMs: number
  sessionId: number
  eventId: number
  frames: Telemetry[]
}

/** Stride for the in-lap point downsample (60Hz → 15Hz), matching
 *  `pointsFromFrames`. Plenty of resolution for the top-down map without
 *  the full 60Hz memory cost. */
const POINT_STRIDE = 4

/**
 * Sector-cell colour state. F1 broadcast convention:
 *   purple  — new sector PB this session
 *   green   — faster than the reference lap's same sector (but not PB)
 *   yellow  — within ±YELLOW_BAND_MS of the reference
 *   red     — slower than the reference + YELLOW_BAND_MS
 *   pending — sector not yet completed this lap
 */
export type SectorKind = 'purple' | 'green' | 'yellow' | 'red' | 'pending'

const SECTOR_COUNT = 3
const YELLOW_BAND_MS = 50

// ----------------------------------------------------------------------------
// Singleton state. Mirrors useTelemetry's module-scope shape so the in-
// progress lap, sector PBs, and reference survive a page navigation away
// from /hotlap and back. The watcher that drives the accumulators is
// installed exactly once into a detached effectScope, so it doesn't get
// torn down with the first calling component.
// ----------------------------------------------------------------------------

const referenceLap = ref<LapReference | null>(null)
const referencePoints = shallowRef<TrackPoint[]>([])
const sectorPBs = ref<SectorPBs>(emptySectorPBs(SECTOR_COUNT))
const currentLapSectorTimes = ref<Array<number | null>>(
  new Array(SECTOR_COUNT).fill(null)
)
// FH6 reports `lap.distance` as cumulative race distance, not per-lap
// (lap 1: 5949→11901, lap 2: 11903→17855, …). The reference lap normalises
// to 0→totalDistanceM, so every comparison needs to subtract the cumulative
// distance captured at the *current* lap's start. Reactive because the
// computeds below depend on it.
const lapStartDistance = ref<number | null>(null)

// Mutable per-frame accumulators. Not refs — nothing reactive reads them,
// only the watcher itself in the same synchronous tick. Avoids per-frame
// array allocations from shallowRef triggers at 60Hz.
let currentLapSamples: LapReferenceSample[] = []
let currentLapPoints: TrackPoint[] = []
let pointStride = 0
let trackedCarOrdinal: number | null = null
let trackedLapNumber: number | null = null
let sectorIndex = 0

let installed = false
let scope: EffectScope | null = null

function resetAll(): void {
  referenceLap.value = null
  referencePoints.value = []
  sectorPBs.value = emptySectorPBs(SECTOR_COUNT)
  currentLapSectorTimes.value = new Array(SECTOR_COUNT).fill(null)
  currentLapSamples = []
  currentLapPoints = []
  pointStride = 0
  trackedLapNumber = null
  sectorIndex = 0
  lapStartDistance.value = null
}

function resetCurrentLap(): void {
  currentLapSectorTimes.value = new Array(SECTOR_COUNT).fill(null)
  currentLapSamples = []
  currentLapPoints = []
  pointStride = 0
  sectorIndex = 0
  lapStartDistance.value = null
}

// PB fallback: when a recording starts and no session-best exists yet, fetch
// the all-time fastest lap for this car+event and install it as the initial
// reference. A subsequent session-best lap supplants it the moment the
// driver beats it. Best-effort — fetch failures stay silent so a dead
// server never blocks the page from working.
async function installPBReference(carOrdinal: number, eventId: number, gameId: string): Promise<void> {
  if (referenceLap.value !== null) return
  let res: PBLapResponse | null
  try {
    res = await $fetch<PBLapResponse | null>(
      `/api/cars/${carOrdinal}/best-lap`,
      // gameId scopes the per-game car catalog — without it non-Forza sims
      // resolve no car and the reference silently falls back to session-best.
      { query: { eventId, gameId } }
    )
  } catch {
    return
  }
  if (!res || !res.frames?.length) return
  // Race with the live lap finishing: re-check after the await.
  if (referenceLap.value !== null) return

  const samples: LapReferenceSample[] = res.frames.map(f => ({
    distance: f.lap.distance,
    clockMs: f.lap.current * 1000
  }))
  const ref = buildLapReference(samples, SECTOR_COUNT)
  if (!ref) return
  if (referenceLap.value !== null) return

  referenceLap.value = ref
  // pointsFromFrames keeps raw cumulative `lap.distance`; rebase to lap-
  // relative so the elevation strip + cursor live in the same space the
  // reference lap does.
  const pts = pointsFromFrames(res.frames)
  if (pts.length > 0) {
    const base = pts[0]!.distance
    for (const p of pts) p.distance -= base
  }
  referencePoints.value = pts
}

function ensureInstalled(): void {
  if (installed) return
  if (!import.meta.client) return
  installed = true

  // Resolve refs via the public composables — same refCount + WS-connect
  // bookkeeping as any other consumer. Called from setup (transitively),
  // so onBeforeUnmount registers against the first calling component.
  const { telemetry } = useTelemetry()
  const { recording } = useRecording()
  // Active game (workspace) — scopes the PB reference lookup to the right
  // per-game car catalog. The recording is tagged with this same game.
  const { gameId } = useGame()

  // Detached scope: watchers must outlive the first calling component, or
  // the singleton state would still survive but stop updating after the
  // first nav-away from /hotlap.
  scope = effectScope(true)
  scope.run(() => {
    watch(telemetry, (t) => {
      if (!t) return
      if (!t.isRaceOn) return // pause / menu — don't accumulate or count laps

      // Car change resets everything: a new car means a new reference set.
      if (t.car.ordinal > 0) {
        if (trackedCarOrdinal !== null && t.car.ordinal !== trackedCarOrdinal) {
          resetAll()
        }
        trackedCarOrdinal = t.car.ordinal
      }

      const lapNum = t.lap.number
      const lapDistance = t.lap.distance
      const lapCurrentMs = t.lap.current * 1000
      const lapLastMs = t.lap.last * 1000

      // Lap completion detected by lap.number change.
      if (trackedLapNumber !== null && lapNum !== trackedLapNumber) {
        if (currentLapSamples.length >= 2 && lapLastMs > 0) {
          const completed = buildLapReference(currentLapSamples, SECTOR_COUNT)
          if (completed) {
            sectorPBs.value = applyCompletedSectors(sectorPBs.value, completed.sectorMs)
            if (referenceLap.value === null || completed.totalMs < referenceLap.value.totalMs) {
              referenceLap.value = completed
              referencePoints.value = currentLapPoints
            }
          }
        }
        resetCurrentLap()
      }
      trackedLapNumber = lapNum

      // Seed lap-start cumulative distance on the first frame of each lap (or
      // the first frame we ever see). Everything below works in lap-relative
      // distance so it matches the reference's normalised [0, totalDistanceM].
      if (lapStartDistance.value === null) {
        lapStartDistance.value = lapDistance
      }
      const lapRelDistance = lapDistance - lapStartDistance.value

      // Append in-lap sample. Drop frames that don't advance distance — Forza
      // occasionally repeats a metre across frames during pause edges.
      const lastSample = currentLapSamples[currentLapSamples.length - 1]
      if (!lastSample || lapRelDistance > lastSample.distance) {
        currentLapSamples.push({ distance: lapRelDistance, clockMs: lapCurrentMs })
      }

      // Downsampled track points for the map. Skip pre-position (0,0) frames
      // and keep every Nth — same shape pointsFromFrames produces for replay.
      if (t.position.x !== 0 || t.position.z !== 0) {
        if (pointStride % POINT_STRIDE === 0) {
          currentLapPoints.push({
            x: t.position.x,
            z: t.position.z,
            y: t.position.y,
            speed: t.speedKmh,
            throttle: t.throttle,
            brake: t.brake,
            distance: lapRelDistance,
            drivingLine: typeof t.drivingLine === 'number' ? t.drivingLine : null
          })
        }
        pointStride++
      }

      // Sector-boundary crossings — only meaningful once we have a reference.
      // Use the reference's totalDistance as the assumed lap length; this is
      // valid because the player runs the same track lap after lap.
      const refLap = referenceLap.value
      if (refLap) {
        while (sectorIndex < SECTOR_COUNT) {
          const boundary = refLap.totalDistanceM * (sectorIndex + 1) / SECTOR_COUNT
          if (lapRelDistance < boundary) break
          const prevSum = currentLapSectorTimes.value
            .slice(0, sectorIndex)
            .reduce<number>((sum, st) => sum + (st ?? 0), 0)
          const sectorTimeMs = Math.max(0, Math.round(lapCurrentMs - prevSum))
          const updated = [...currentLapSectorTimes.value]
          updated[sectorIndex] = sectorTimeMs
          currentLapSectorTimes.value = updated
          sectorIndex++
        }
      }
    })

    watch(recording, (r) => {
      if (r.state !== 'recording') return
      void installPBReference(r.carOrdinal, r.eventId, gameId.value)
    }, { immediate: true })
  })
}

/**
 * Live hotlap state: reference-lap-based rolling delta, predicted lap,
 * theoretical best, and per-sector deltas as you cross boundaries.
 *
 * Singleton — state survives page navigation, exactly like useTelemetry.
 * The first call wires up the long-lived watcher; subsequent calls just
 * return the shared refs.
 *
 * Reference is the session's best completed lap so far, with a PB fallback
 * fetched from the server when a recording starts. Until a reference exists
 * the page shows `—` everywhere.
 */
export function useHotlapReference() {
  ensureInstalled()

  const { telemetry } = useTelemetry()

  const rollingDeltaMs = computed<number | null>(() => {
    const t = telemetry.value
    const ref = referenceLap.value
    const base = lapStartDistance.value
    if (!t || !ref || base === null) return null
    const refClock = referenceClockAt(ref, t.lap.distance - base)
    if (refClock === null) return null
    return Math.round(t.lap.current * 1000 - refClock)
  })

  const predictedLapMs = computed<number | null>(() => {
    const ref = referenceLap.value
    const d = rollingDeltaMs.value
    if (!ref || d === null) return null
    return Math.round(ref.totalMs + d)
  })

  const theoreticalLapMs = computed<number | null>(() => theoreticalLapMsFn(sectorPBs.value))

  // Map completed sector times → render-ready {deltaMs, kind}. Comparisons
  // use the PBs and reference snapshots that existed BEFORE this lap, since
  // PBs only update at lap completion (not at sector crossing).
  const sectorStates = computed<Array<{ deltaMs: number, kind: SectorKind } | null>>(() => {
    const ref = referenceLap.value
    const pbs = sectorPBs.value.bestMs
    return currentLapSectorTimes.value.map((t, i) => {
      if (t === null) return null
      const refSecMs = ref?.sectorMs[i] ?? null
      const prevPB = pbs[i] ?? null
      let kind: SectorKind
      if (prevPB === null || t < prevPB) {
        kind = 'purple'
      } else if (refSecMs !== null && t < refSecMs) {
        kind = 'green'
      } else if (refSecMs !== null && Math.abs(t - refSecMs) <= YELLOW_BAND_MS) {
        kind = 'yellow'
      } else {
        kind = 'red'
      }
      return {
        deltaMs: refSecMs !== null ? t - refSecMs : 0,
        kind
      }
    })
  })

  // Live position for the track-map cursor. Mirrors ReplayPlayer's contract
  // for the TrackMap component. Null when the player is on a loading screen.
  const currentPoint = computed<{ x: number, z: number, y: number, distance: number } | null>(() => {
    const t = telemetry.value
    if (!t) return null
    if (t.position.x === 0 && t.position.z === 0) return null
    const base = lapStartDistance.value
    return {
      x: t.position.x,
      z: t.position.z,
      y: t.position.y,
      distance: base === null ? 0 : t.lap.distance - base
    }
  })

  return {
    referenceLap,
    referencePoints,
    currentPoint,
    rollingDeltaMs,
    predictedLapMs,
    theoreticalLapMs,
    sectorStates
  }
}
