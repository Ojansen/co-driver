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

/**
 * Live hotlap state: reference-lap-based rolling delta, predicted lap,
 * theoretical best, and per-sector deltas as you cross boundaries.
 *
 * Reference is the session's best completed lap so far. No PB fallback
 * yet — the page shows `—` until the driver completes a first lap. The
 * fallback will plug in here when the server endpoint lands.
 */
export function useHotlapReference() {
  const { telemetry } = useTelemetry()
  const { recording } = useRecording()

  const referenceLap = ref<LapReference | null>(null)
  const referencePoints = shallowRef<TrackPoint[]>([])
  const sectorPBs = ref<SectorPBs>(emptySectorPBs(SECTOR_COUNT))
  // Sector times of the in-progress lap as boundaries are crossed. Updated
  // imperatively from the telemetry watcher; rendered via a computed that
  // maps them to {deltaMs, kind} against the reference + PBs.
  const currentLapSectorTimes = ref<Array<number | null>>(
    new Array(SECTOR_COUNT).fill(null)
  )

  // Mutable per-frame accumulators. Not refs — nothing reactive reads them,
  // only the watcher itself in the same synchronous tick. Avoids per-frame
  // array allocations from shallowRef triggers at 60Hz.
  let currentLapSamples: LapReferenceSample[] = []
  let currentLapPoints: TrackPoint[] = []
  let pointStride = 0
  let trackedCarOrdinal: number | null = null
  let trackedLapNumber: number | null = null
  let sectorIndex = 0

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
  }

  function resetCurrentLap(): void {
    currentLapSectorTimes.value = new Array(SECTOR_COUNT).fill(null)
    currentLapSamples = []
    currentLapPoints = []
    pointStride = 0
    sectorIndex = 0
  }

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

    // Append in-lap sample. Drop frames that don't advance distance — Forza
    // occasionally repeats a metre across frames during pause edges.
    const lastSample = currentLapSamples[currentLapSamples.length - 1]
    if (!lastSample || lapDistance > lastSample.distance) {
      currentLapSamples.push({ distance: lapDistance, clockMs: lapCurrentMs })
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
          distance: lapDistance,
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
        if (lapDistance < boundary) break
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

  // -------------------------------------------------------------------------
  // Reactive outputs
  // -------------------------------------------------------------------------

  const rollingDeltaMs = computed<number | null>(() => {
    const t = telemetry.value
    const ref = referenceLap.value
    if (!t || !ref) return null
    const refClock = referenceClockAt(ref, t.lap.distance)
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

  // -------------------------------------------------------------------------
  // PB fallback: when a recording starts and no session-best exists yet, fetch
  // the all-time fastest lap for this car+event and install it as the initial
  // reference. A subsequent session-best lap supplants it the moment the
  // driver beats it. Best-effort — fetch failures stay silent so a dead
  // server never blocks the page from working.
  // -------------------------------------------------------------------------
  async function installPBReference(carOrdinal: number, eventId: number): Promise<void> {
    if (referenceLap.value !== null) return
    let res: PBLapResponse | null
    try {
      res = await $fetch<PBLapResponse | null>(
        `/api/cars/${carOrdinal}/best-lap`,
        { query: { eventId } }
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
    referencePoints.value = pointsFromFrames(res.frames)
  }

  watch(recording, (r) => {
    if (r.state !== 'recording') return
    void installPBReference(r.carOrdinal, r.eventId)
  }, { immediate: true })

  // Live position for the track-map cursor. Mirrors ReplayPlayer's contract
  // for the TrackMap component. Null when the player is on a loading screen.
  const currentPoint = computed<{ x: number, z: number, y: number, distance: number } | null>(() => {
    const t = telemetry.value
    if (!t) return null
    if (t.position.x === 0 && t.position.z === 0) return null
    return {
      x: t.position.x,
      z: t.position.z,
      y: t.position.y,
      distance: t.lap.distance
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
