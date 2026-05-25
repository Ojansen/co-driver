/**
 * Auto-baseline tune calculator.
 *
 * Given a build + three user dials (stiffness, balance, surface), produces a
 * starting-point tune. The output is a seed for the existing /tune diagnostic
 * workflow — NOT a finished tune. Players are expected to drive it, read the
 * damper / load / G-G diagnostics, and refine from there.
 *
 * Storage units are Forza-canonical throughout (lb/in springs, psi pressure,
 * inches ride height, lb downforce, degrees, % for diff/brake/aero-balance,
 * 1–20 dampers, 1–65 ARB). The frequency-method spring formula goes through
 * N/mm internally; everything else is dimensionless or already canonical.
 *
 * The constants in the CALIBRATION section are starting estimates from
 * suspension physics + community norms. They need verification against the
 * ForzaTune FH6-beta calculator for ~6 representative builds × 3 stiffness
 * dials. Until then, expect outputs to be in the right neighborhood but not
 * tournament-ready.
 */

import type { BuildSettings } from './build-fields'
import type { TuneSettings } from './tune-fields'

export type Stiffness = 'soft' | 'medium' | 'stiff'
export type Balance = 'loose' | 'neutral' | 'tight'
export type Surface = 'road' | 'dirt' | 'cross-country'

export interface AutoTuneDials {
  stiffness: Stiffness
  balance: Balance
  surface: Surface
}

export const STIFFNESS_OPTIONS: Stiffness[] = ['soft', 'medium', 'stiff']
export const BALANCE_OPTIONS: Balance[] = ['loose', 'neutral', 'tight']
export const SURFACE_OPTIONS: Surface[] = ['road', 'dirt', 'cross-country']

const STIFFNESS_MUL: Record<Stiffness, number> = {
  soft: 0.85,
  medium: 1.00,
  stiff: 1.15
}

// Balance: loose (oversteer-leaning) = −1, tight (understeer-leaning) = +1.
// Tight ⇒ stiffer front (springs, ARB, dampers), softer rear, more rear toe-in,
// more front brake bias, more accel-lock for traction.
const BALANCE_VAL: Record<Balance, number> = {
  loose: -1,
  neutral: 0,
  tight: 1
}

// --- CALIBRATION ----------------------------------------------------------
// VERIFY: capture ForzaTune FH6-beta outputs across {6 builds} × {3 stiffness}
// and refit. Damper 1–20 mapping and ARB 1–65 mapping are the biggest unknowns.

/** Fraction of total mass attributed to wheels, tires, brakes, half of arms. */
const UNSPRUNG_RATIO = 0.13

/** Front suspension frequency (Hz) at neutral dials, by surface. Rear gets
 *  +FREQ_REAR_OFFSET for "flat-ride" tuning (rear settles faster than front). */
const FREQ_FRONT_BASE: Record<Surface, number> = {
  'road': 2.0,
  'dirt': 1.6,
  'cross-country': 1.4
}
const FREQ_REAR_OFFSET = 0.2

/** Damper midpoints on FH's 1–20 scale at neutral dials. */
const DAMPER_BUMP_BASE = 8
const DAMPER_REBOUND_BASE = 11

/** ARB midpoints on FH's 1–65 scale at neutral dials. */
const ARB_FRONT_BASE = 30
const ARB_REAR_BASE = 28

/** Ride height (inches) by surface — set near the practical minimum for road,
 *  more clearance for dirt / cross-country. */
const RIDE_HEIGHT_IN: Record<Surface, number> = {
  'road': 4.0,
  'dirt': 5.0,
  'cross-country': 6.0
}

const CAMBER_FRONT_BASE: Record<Surface, number> = {
  'road': -1.8,
  'dirt': -0.8,
  'cross-country': -0.3
}
const CAMBER_REAR_OFFSET = 0.6 // rear less negative than front

const TIRE_PRESSURE_PSI: Record<Surface, number> = {
  'road': 29.0,
  'dirt': 22.0,
  'cross-country': 18.0
}

const CASTER_DEG = 5.0
const TOE_REAR_BASE = 0.15 // slight rear toe-in for stability

const BRAKE_BALANCE_BASE = 52 // % front
const BRAKE_PRESSURE = 100

// --- HELPERS --------------------------------------------------------------

/** 1 N/mm = 5.71015 lb/in (= 1 / 0.175127). */
const N_PER_MM_TO_LB_PER_IN = 5.71015

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Spring rate from sprung mass + target natural frequency.
 *  k (N/mm) = (2π·f)² · m / 1000, then converted to lb/in. */
function springRateLbIn(sprungMassKg: number, freqHz: number): number {
  const kNperMm = Math.pow(2 * Math.PI * freqHz, 2) * sprungMassKg / 1000
  return kNperMm * N_PER_MM_TO_LB_PER_IN
}

// --- CALCULATOR -----------------------------------------------------------

export interface AutoTuneOptions {
  build: BuildSettings
  dials: AutoTuneDials
}

export interface AutoTuneResult {
  /** Tune settings, ready to seed a new tune row via /api/builds/[id]/tunes. */
  tune: TuneSettings
  /** Missing build fields that make the seed too incomplete to be useful —
   *  if non-empty, the UI should refuse to save (Springs + Diff would both
   *  be skipped, leaving only the surface/dial-derived sliders). */
  blockers: string[]
  /** Sections that were skipped because the build lacked optional fields. */
  warnings: string[]
}

/** Build fields without which the seed is not worth saving. */
export const AUTO_TUNE_REQUIRED_FIELDS = ['weight', 'weightFrontPct', 'drivetrain'] as const

const REQUIRED_FIELD_LABELS: Record<typeof AUTO_TUNE_REQUIRED_FIELDS[number], string> = {
  weight: 'Weight',
  weightFrontPct: 'Weight distribution',
  drivetrain: 'Drivetrain'
}

/** Returns the human-readable labels of any required build fields that are
 *  missing or empty. Used by both the calculator and the UI gating layer. */
export function missingRequiredFields(build: BuildSettings): string[] {
  const missing: string[] = []
  for (const id of AUTO_TUNE_REQUIRED_FIELDS) {
    const v = build[id]
    if (v === null || v === undefined || v === '') {
      missing.push(REQUIRED_FIELD_LABELS[id])
    } else if (id !== 'drivetrain' && typeof v !== 'number') {
      missing.push(REQUIRED_FIELD_LABELS[id])
    }
  }
  return missing
}

export function computeAutoTune(opts: AutoTuneOptions): AutoTuneResult {
  const { build, dials } = opts
  const warnings: string[] = []
  const blockers = missingRequiredFields(build).map(label => `${label} missing on build`)
  const tune: TuneSettings = {}

  const stiff = STIFFNESS_MUL[dials.stiffness]
  const bal = BALANCE_VAL[dials.balance]

  // Springs — frequency method, needs weight + front distribution.
  const weight = typeof build.weight === 'number' ? build.weight : null
  const distPct = typeof build.weightFrontPct === 'number' ? build.weightFrontPct : null
  if (weight !== null && distPct !== null) {
    const frontDist = clamp(distPct / 100, 0.2, 0.8)
    const sprungTotal = weight * (1 - UNSPRUNG_RATIO)
    const sprungF = sprungTotal * frontDist / 2
    const sprungR = sprungTotal * (1 - frontDist) / 2
    const freqFBase = FREQ_FRONT_BASE[dials.surface]
    const freqRBase = freqFBase + FREQ_REAR_OFFSET
    // Tight ⇒ stiffer front, softer rear (load to front to reduce rotation).
    const freqF = freqFBase * stiff * (1 + 0.05 * bal)
    const freqR = freqRBase * stiff * (1 - 0.05 * bal)
    tune.springsFront = Math.round(springRateLbIn(sprungF, freqF))
    tune.springsRear = Math.round(springRateLbIn(sprungR, freqR))
  }
  // (When weight or weightFrontPct is missing, blockers prevents submission;
  // springs are left undefined in the preview.)

  // Dampers — stiffness drives magnitude, balance shifts F/R.
  const bump = DAMPER_BUMP_BASE * stiff
  const reb = DAMPER_REBOUND_BASE * stiff
  tune.bumpFront = Math.round(clamp(bump + bal, 1, 20))
  tune.bumpRear = Math.round(clamp(bump - bal, 1, 20))
  tune.reboundFront = Math.round(clamp(reb + bal, 1, 20))
  tune.reboundRear = Math.round(clamp(reb - bal, 1, 20))

  // ARB — stiffer end ⇒ more load transfer ⇒ less grip at that end.
  tune.arbFront = Math.round(clamp(ARB_FRONT_BASE * stiff * (1 + 0.10 * bal), 1, 65))
  tune.arbRear = Math.round(clamp(ARB_REAR_BASE * stiff * (1 - 0.10 * bal), 1, 65))

  // Ride height — surface-driven; same front/rear for v1.
  const rh = RIDE_HEIGHT_IN[dials.surface]
  tune.rideHeightFront = rh
  tune.rideHeightRear = rh

  // Alignment.
  const camberF = CAMBER_FRONT_BASE[dials.surface]
  tune.camberFront = Number(camberF.toFixed(1))
  tune.camberRear = Number((camberF + CAMBER_REAR_OFFSET).toFixed(1))
  tune.casterFront = CASTER_DEG
  tune.toeFront = 0.0
  // Tight ⇒ more rear toe-in for stability; loose ⇒ less.
  tune.toeRear = Number((TOE_REAR_BASE * (1 + 0.5 * bal)).toFixed(2))

  // Tire pressure — flat F/R for v1; player adjusts after seeing tire-temp data.
  const tp = TIRE_PRESSURE_PSI[dials.surface]
  tune.tirePressureFront = tp
  tune.tirePressureRear = tp

  // Differential — drivetrain-gated. Tight ⇒ more lock (more traction bias).
  const drivetrain = typeof build.drivetrain === 'string' ? build.drivetrain : null
  if (drivetrain === 'fwd') {
    tune.frontAccel = clamp(Math.round(25 + 5 * bal), 0, 100)
    tune.frontDecel = 0
  } else if (drivetrain === 'rwd') {
    tune.rearAccel = clamp(Math.round(50 + 5 * bal), 0, 100)
    tune.rearDecel = 20
  } else if (drivetrain === 'awd') {
    tune.frontAccel = 30
    tune.frontDecel = 10
    tune.rearAccel = 50
    tune.rearDecel = 15
    // % rear (more rear ⇒ more RWD-like behavior).
    tune.centerBalance = clamp(Math.round(65 - 5 * bal), 30, 90)
  }
  // (Missing drivetrain is a blocker — diff fields stay undefined in preview.)

  // Brakes — slight front-bias bump for tight, dial back for loose.
  tune.brakeBalance = clamp(Math.round(BRAKE_BALANCE_BASE + 2 * bal), 30, 70)
  tune.brakePressure = BRAKE_PRESSURE

  // Aero — absolute downforce values depend on each car's max slider, which we
  // don't know. Emit only aeroBalance % and leave the F/R sliders for the
  // player to set against their car's range. See /tune/aero for guidance.
  const aero = typeof build.aero === 'string' ? build.aero : 'none'
  if (aero !== 'none') {
    // Rear-bias default (more stable); tight shifts forward.
    tune.aeroBalance = clamp(Math.round(40 + 5 * bal), 20, 80)
  }

  tune.notes = `Auto-baseline · ${dials.stiffness}/${dials.balance}/${dials.surface}. Seed for /tune diagnostics — drive it and refine.`

  return { tune, blockers, warnings }
}

/** Short slug for naming the generated tune ("baseline-med-neutral-road"). */
export function autoTuneSlug(dials: AutoTuneDials): string {
  const surf = dials.surface === 'cross-country' ? 'cross' : dials.surface
  return `baseline-${dials.stiffness}-${dials.balance}-${surf}`
}
