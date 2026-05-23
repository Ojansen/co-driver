/**
 * Per-slug bindings for /upgrade/[slug] "Your data" panels. Same Binding
 * shape as tune-data-bindings.ts — the panel component selects which
 * registry to read via its `side` prop.
 *
 * Narrower than the tune side: only the 5 upgrade categories where
 * telemetry genuinely informs the decision (tires, drivetrain-conversion,
 * engine-swap, aspiration, aero-body). The other 5 upgrade slugs (brakes,
 * suspension-class, drivetrain-parts, weight, rims) have no binding and
 * silently render nothing — either the build artifact already answers the
 * question (weight, rims) or the relevant signals belong on a /tune page
 * (brakes overlaps /tune/brakes, drivetrain-parts overlaps
 * /tune/differential, suspension-class overlaps /tune/springs).
 */

import type { Binding, Row } from './tune-data-bindings'

// --- unit-agnostic formatters ---------------------------------------------

const pct = (v: number, decimals = 1): string => `${(v * 100).toFixed(decimals)}%`
const num = (v: number, decimals = 2): string => v.toFixed(decimals)
const rpm = (v: number): string => `${Math.round(v)} rpm`
const drivetrainLabel = (d: 'fwd' | 'rwd' | 'awd' | null): string => {
  if (d === 'fwd') return 'FWD'
  if (d === 'rwd') return 'RWD'
  if (d === 'awd') return 'AWD'
  return '— (build has no drivetrain set)'
}

// --- bindings --------------------------------------------------------------

export const UPGRADE_DATA_BINDINGS: Record<string, Binding> = {
  'tires': ({ signals: s, drivetrain, fmt }) => {
    const rows: Row[] = [
      { label: 'FL temp avg', value: fmt.temp(s.tireTempC.fl) },
      { label: 'FR temp avg', value: fmt.temp(s.tireTempC.fr) },
      { label: 'RL temp avg', value: fmt.temp(s.tireTempC.rl) },
      { label: 'RR temp avg', value: fmt.temp(s.tireTempC.rr) },
      { label: `All four in ${fmt.temp(85)}–${fmt.temp(100)}`, value: pct(s.tireTempC.allOptimalPct) }
    ]
    if (drivetrain === 'fwd') {
      rows.push({ label: 'Front L slip ratio (throttle > 0.5)', value: pct(s.slipRatio.fl, 1) })
      rows.push({ label: 'Front R slip ratio (throttle > 0.5)', value: pct(s.slipRatio.fr, 1) })
    } else if (drivetrain === 'awd') {
      const frontAvg = (s.slipRatio.fl + s.slipRatio.fr) / 2
      const rearAvg = (s.slipRatio.rl + s.slipRatio.rr) / 2
      rows.push({ label: 'Front axle slip avg (throttle > 0.5)', value: pct(frontAvg, 1) })
      rows.push({ label: 'Rear axle slip avg (throttle > 0.5)', value: pct(rearAvg, 1) })
    } else {
      // rwd or unknown — default to rear
      rows.push({ label: 'Rear L slip ratio (throttle > 0.5)', value: pct(s.slipRatio.rl, 1) })
      rows.push({ label: 'Rear R slip ratio (throttle > 0.5)', value: pct(s.slipRatio.rr, 1) })
    }
    return rows
  },
  'drivetrain-conversion': ({ signals: s, drivetrain }) => {
    const frontAvg = (s.slipRatio.fl + s.slipRatio.fr) / 2
    const rearAvg = (s.slipRatio.rl + s.slipRatio.rr) / 2
    return [
      { label: 'Current drivetrain', value: drivetrainLabel(drivetrain) },
      { label: 'Front axle slip avg (throttle > 0.5)', value: pct(frontAvg, 1) },
      { label: 'Rear axle slip avg (throttle > 0.5)', value: pct(rearAvg, 1) },
      { label: 'Rear − Front Δ', value: pct(rearAvg - frontAvg, 2) }
    ]
  },
  'engine-swap': ({ signals: s, fmt }) => [
    { label: 'Peak power', value: fmt.power(s.power.peakPowerKw) },
    { label: 'Peak torque', value: fmt.torque(s.power.peakTorqueNm) },
    { label: 'RPM at peak power', value: rpm(s.power.rpmAtPeakPower) },
    { label: 'Frames at ≥ 98% rpmMax', value: pct(s.gear.atRevLimitPct, 2) }
  ],
  'aspiration': ({ signals: s, fmt }) => [
    { label: 'Peak boost', value: num(s.boost.peakBoost, 2) },
    { label: 'Avg boost (throttle > 0.5)', value: num(s.boost.avgUnderThrottle, 2) },
    { label: 'Peak power', value: fmt.power(s.power.peakPowerKw) },
    { label: 'Peak torque', value: fmt.torque(s.power.peakTorqueNm) }
  ],
  'aero-body': ({ signals: s, fmt }) => [
    { label: 'Top speed', value: fmt.speed(s.aero.topSpeedKmh) },
    { label: `Lateral G p95 above ${fmt.speed(150)}`, value: num(Math.abs(s.aero.lateralGP95HighSpeed) / 9.81) + ' g' },
    { label: `Frames above ${fmt.speed(150)}`, value: String(s.aero.highSpeedFrames) }
  ]
}
