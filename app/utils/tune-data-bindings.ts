/**
 * Per-slug bindings declaring which signals the /tune/[slug] "Your data"
 * panel surfaces, and how to format them. Endpoint computes everything in
 * one walk; this registry picks the subset each page cares about.
 *
 * Adding a new slug? Add the slug key to TUNE_DATA_BINDINGS. Adding a new
 * measurement? Add the helper to tune-signals.ts and reference it here via
 * a `read(signals)` selector.
 */

import type { FrameAggregates } from './tune-signals'

export type Drivetrain = 'fwd' | 'rwd' | 'awd' | null

export interface Row {
  label: string
  /** Pre-formatted display value. */
  value: string
}

export interface BindingContext {
  signals: FrameAggregates
  drivetrain: Drivetrain
}

/** Returns the rows to render, or null when this slug shouldn't render anything for the current context (e.g. center-diff on a RWD car). */
export type Binding = (ctx: BindingContext) => Row[] | null

// --- formatters ------------------------------------------------------------

const pct = (v: number, decimals = 1): string => `${(v * 100).toFixed(decimals)}%`
const num = (v: number, decimals = 2): string => v.toFixed(decimals)
const kmh = (v: number): string => `${Math.round(v)} km/h`
const radDeg = (v: number): string => `${(v * 180 / Math.PI).toFixed(1)}°`
const tempC = (v: number): string => `${v.toFixed(1)} °C`
const rpm = (v: number): string => `${Math.round(v)} rpm`

// --- bindings --------------------------------------------------------------

export const TUNE_DATA_BINDINGS: Record<string, Binding> = {
  'springs': ({ signals: s }) => [
    { label: 'Front travel avg', value: pct(s.suspensionTravel.frontAvg) },
    { label: 'Front travel p95', value: pct(s.suspensionTravel.frontP95) },
    { label: 'Rear travel avg', value: pct(s.suspensionTravel.rearAvg) },
    { label: 'Rear travel p95', value: pct(s.suspensionTravel.rearP95) },
    { label: 'Frames > 95% compressed', value: pct(s.suspensionTravel.bottomingPct, 2) }
  ],
  'dampers': ({ signals: s }) => [
    { label: 'Travel oscillation (Δ/frame stdev)', value: num(s.suspensionTravel.oscillation, 4) },
    { label: 'Front travel p95', value: pct(s.suspensionTravel.frontP95) },
    { label: 'Rear travel p95', value: pct(s.suspensionTravel.rearP95) },
    { label: 'Frames > 95% compressed', value: pct(s.suspensionTravel.bottomingPct, 2) }
  ],
  'anti-roll-bars': ({ signals: s }) => [
    { label: 'Front |slip angle| avg', value: radDeg(s.slipAngle.frontAvg) },
    { label: 'Rear |slip angle| avg', value: radDeg(s.slipAngle.rearAvg) },
    { label: 'Lateral G p95', value: num(Math.abs(s.lateralG.p95) / 9.81) + ' g' }
  ],
  'ride-height': ({ signals: s }) => [
    { label: 'Front travel avg', value: pct(s.suspensionTravel.frontAvg) },
    { label: 'Rear travel avg', value: pct(s.suspensionTravel.rearAvg) },
    { label: 'Rumble-strip contact', value: pct(s.rumbleContactPct, 2) }
  ],
  'alignment': ({ signals: s }) => [
    { label: 'FL temp avg', value: tempC(s.tireTempC.fl) },
    { label: 'FR temp avg', value: tempC(s.tireTempC.fr) },
    { label: 'RL temp avg', value: tempC(s.tireTempC.rl) },
    { label: 'RR temp avg', value: tempC(s.tireTempC.rr) },
    { label: 'Front L/R Δ', value: tempC(s.tireTempC.fl - s.tireTempC.fr) },
    { label: 'Rear L/R Δ', value: tempC(s.tireTempC.rl - s.tireTempC.rr) }
  ],
  'tire-pressure': ({ signals: s }) => [
    { label: 'FL temp avg', value: tempC(s.tireTempC.fl) },
    { label: 'FR temp avg', value: tempC(s.tireTempC.fr) },
    { label: 'RL temp avg', value: tempC(s.tireTempC.rl) },
    { label: 'RR temp avg', value: tempC(s.tireTempC.rr) },
    { label: 'All four in 85–100 °C', value: pct(s.tireTempC.allOptimalPct) }
  ],
  'differential': ({ signals: s, drivetrain }) => {
    if (drivetrain === 'fwd') {
      return [
        { label: 'Front L slip ratio (throttle > 0.5)', value: pct(s.slipRatio.fl, 1) },
        { label: 'Front R slip ratio (throttle > 0.5)', value: pct(s.slipRatio.fr, 1) },
        { label: 'Front L−R Δ', value: pct(s.slipRatio.fl - s.slipRatio.fr, 2) }
      ]
    }
    if (drivetrain === 'awd') {
      return [
        { label: 'Front L slip ratio', value: pct(s.slipRatio.fl, 1) },
        { label: 'Front R slip ratio', value: pct(s.slipRatio.fr, 1) },
        { label: 'Rear L slip ratio', value: pct(s.slipRatio.rl, 1) },
        { label: 'Rear R slip ratio', value: pct(s.slipRatio.rr, 1) }
      ]
    }
    // rwd or unknown — default to rear
    return [
      { label: 'Rear L slip ratio (throttle > 0.5)', value: pct(s.slipRatio.rl, 1) },
      { label: 'Rear R slip ratio (throttle > 0.5)', value: pct(s.slipRatio.rr, 1) },
      { label: 'Rear L−R Δ', value: pct(s.slipRatio.rl - s.slipRatio.rr, 2) }
    ]
  },
  'center-diff': ({ signals: s, drivetrain }) => {
    if (drivetrain !== 'awd') return null
    const frontAvg = (s.slipRatio.fl + s.slipRatio.fr) / 2
    const rearAvg = (s.slipRatio.rl + s.slipRatio.rr) / 2
    return [
      { label: 'Front axle slip avg (throttle > 0.5)', value: pct(frontAvg, 1) },
      { label: 'Rear axle slip avg (throttle > 0.5)', value: pct(rearAvg, 1) },
      { label: 'Rear − Front Δ', value: pct(rearAvg - frontAvg, 2) }
    ]
  },
  'brakes': ({ signals: s }) => [
    { label: 'Peak brake input', value: pct(s.brake.peakPressure) },
    { label: 'Avg entry brake (first 200 ms)', value: pct(s.brake.avgEntryPressure) },
    { label: 'Braking events', value: String(s.brake.brakingEvents) }
  ],
  'aero': ({ signals: s }) => [
    { label: 'Top speed', value: kmh(s.aero.topSpeedKmh) },
    { label: 'Lateral G p95 above 150 km/h', value: num(Math.abs(s.aero.lateralGP95HighSpeed) / 9.81) + ' g' },
    { label: 'Frames above 150 km/h', value: String(s.aero.highSpeedFrames) }
  ],
  'gearing': ({ signals: s }) => {
    const rows: Row[] = []
    const gears = Object.keys(s.gear.rpmByGear)
      .map(Number)
      .filter(g => g >= 1 && g <= 8)
      .sort((a, b) => a - b)
    for (const g of gears) {
      rows.push({ label: `Gear ${g} avg rpm`, value: rpm(s.gear.rpmByGear[g] ?? 0) })
    }
    rows.push({ label: 'Frames at ≥ 98% rpmMax', value: pct(s.gear.atRevLimitPct, 2) })
    rows.push({ label: 'Shifts', value: String(s.gear.shiftCount) })
    return rows
  }
}
