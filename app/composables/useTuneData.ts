import type { FrameAggregates } from '~/utils/tune-signals'
import type { Drivetrain } from '~/utils/tune-data-bindings'
import type { DamperHistogram, DamperScatterPoint } from '~/utils/damper-velocity'
import type { RideHeightHistogram } from '~/utils/ride-height'
import type { BinnedValues } from '~/utils/histogram-core'
import type { QuadDistribution } from '~/utils/channel-distributions'
import type { DynoCurve } from '~/utils/dyno'

export interface TuneDataResponse {
  car: { ordinal: number, displayName: string | null, class: number | null } | null
  build: { id: number, name: string | null } | null
  drivetrain: Drivetrain
  lapCount: number
  frameCount: number
  signals: FrameAggregates
  damperHistograms: {
    fl: DamperHistogram
    fr: DamperHistogram
    rl: DamperHistogram
    rr: DamperHistogram
  } | null
  rideHeightHistograms: {
    fl: RideHeightHistogram
    fr: RideHeightHistogram
    rl: RideHeightHistogram
    rr: RideHeightHistogram
  } | null
  damperScatter: {
    fl: DamperScatterPoint[]
    fr: DamperScatterPoint[]
    rl: DamperScatterPoint[]
    rr: DamperScatterPoint[]
  } | null
  rpmHistogram: BinnedValues | null
  slipAngleBalance: BinnedValues | null
  tireTemp: QuadDistribution | null
  slipRatio: QuadDistribution | null
  dynoCurve: DynoCurve | null
}

/**
 * Fetches /api/tune-data with the current ?car / ?build query params (or
 * none, in which case the endpoint falls back to the most recent session).
 *
 * Re-fetches when the params change so deep-linking from session detail
 * pages works without a full reload.
 */
export function useTuneData() {
  const route = useRoute()
  const query = computed(() => {
    const q: Record<string, string> = {}
    const car = route.query.car
    const build = route.query.build
    if (typeof car === 'string' && car.length > 0) q.car = car
    if (typeof build === 'string' && build.length > 0) q.build = build
    return q
  })
  return useFetch<TuneDataResponse>('/api/tune-data', {
    query,
    key: 'tune-data'
  })
}
