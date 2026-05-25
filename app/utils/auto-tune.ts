/**
 * Auto-baseline tune calculator.
 *
 * Given a build + three user dials (stiffness, balance, surface), produces a
 * starting-point tune. The output is a seed for the existing /tune diagnostic
 * workflow — NOT a finished tune. Players are expected to drive it, read the
 * damper / load / G-G diagnostics, and refine from there.
 *
 * Storage units are Forza-canonical throughout (lb/in springs, psi pressure,
 * inches ride height, lb downforce, degrees, % for diff/brake, 1–20 dampers,
 * 1–65 ARB). FH6's metric spring slider reads in N/mm and the metric aero
 * slider in kgf — the unit composable handles the display conversion. The
 * frequency-method spring formula goes through N/mm internally; everything
 * else is dimensionless or already canonical.
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
 *  +FREQ_REAR_OFFSET for "flat-ride" tuning (rear settles faster than front).
 *  Penske Shocks industry guidance: street 0.5-1.5 Hz, non-aero race 1.5-2.5,
 *  moderate downforce 2.5-3.5. 2.0 Hz sits in non-aero-race for road, with
 *  dirt and cross-country progressively softer for compliance. */
const FREQ_FRONT_BASE: Record<Surface, number> = {
  'road': 2.0,
  'dirt': 1.6,
  'cross-country': 1.4
}
const FREQ_REAR_OFFSET = 0.2

/** Damper midpoints on FH's 1–20 scale at neutral dials, for the reference
 *  build (see REFERENCE_*). Real damper rate scales with √(sprung mass)
 *  per axle — critical damping is c ∝ √(k·m), and spring already encodes
 *  mass via the frequency method. */
const DAMPER_BUMP_BASE = 8
const DAMPER_REBOUND_BASE = 11

/** ARB midpoints on FH's 1–65 scale at neutral dials, for the reference
 *  build. Heavier car ⇒ more body roll moment ⇒ stiffer ARB; scales
 *  linearly with total mass relative to the reference. */
const ARB_FRONT_BASE = 30
const ARB_REAR_BASE = 28

/** Reference build for the build-aware multipliers below.
 *
 *  Anchored to the values of the canonical test fixture (`RWD_S2_BUILD`
 *  in test/unit/auto-tune.test.ts) so the existing precision assertions
 *  continue to land at the same numeric outputs — a build matching the
 *  reference produces a `*Scale === 1.0` multiplier everywhere, leaving
 *  the dial-only path unchanged. Builds that differ from the reference
 *  on weight / distribution / tire width get correspondingly different
 *  dampers, ARBs, tire pressure, and brake balance. */
const REFERENCE_TOTAL_KG = 1400
const REFERENCE_FRONT_PCT = 48
const REFERENCE_TIRE_WIDTH_MM = 245
const REFERENCE_SPRUNG_F = REFERENCE_TOTAL_KG * (1 - UNSPRUNG_RATIO) * (REFERENCE_FRONT_PCT / 100) / 2
const REFERENCE_SPRUNG_R = REFERENCE_TOTAL_KG * (1 - UNSPRUNG_RATIO) * (1 - REFERENCE_FRONT_PCT / 100) / 2
const REFERENCE_UNSPRUNG_PER_CORNER = UNSPRUNG_RATIO * REFERENCE_TOTAL_KG / 4
const REFERENCE_CORNER_LOAD_F = REFERENCE_SPRUNG_F + REFERENCE_UNSPRUNG_PER_CORNER
const REFERENCE_CORNER_LOAD_R = REFERENCE_SPRUNG_R + REFERENCE_UNSPRUNG_PER_CORNER

/** Power for the tire-pressure scaling exponent (load-per-mm-of-tread).
 *  Sim-realistic tire pressure varies in a narrow ±~5 psi range around
 *  the surface baseline; pow=0.4 keeps the magnitude in that range
 *  rather than the dramatic ±30% that linear scaling would produce. */
const TIRE_PRESSURE_LOAD_EXP = 0.4

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

// Tire pressures anchored to FH6's 0.1-bar step so the value lands exactly on
// a slider notch in metric. Stored as canonical psi via BAR_TO_PSI.
const BAR_TO_PSI = 14.5038
const TIRE_PRESSURE_BAR: Record<Surface, number> = {
  'road': 2.0,
  'dirt': 1.5,
  'cross-country': 1.2
}

const CASTER_DEG = 5.0
const TOE_REAR_BASE = 0.15 // slight rear toe-in for stability

const BRAKE_BALANCE_BASE = 52 // % front
const BRAKE_PRESSURE = 100

// Aero — values are stored in lb (Forza-canonical); metric display is kgf.
// FH6 sliders are per-car so absolute max varies; these are conservative
// mid-range defaults for an aero-equipped circuit build.
const AERO_FRONT_BASE_LB = 150
const AERO_REAR_BASE_LB = 250

// --- HELPERS --------------------------------------------------------------

/** 1 N/mm = 5.71015 lb/in (= 1 / 0.175127). */
const N_PER_MM_TO_LB_PER_IN = 5.71015

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Round to 1 decimal — matches FH6's 0.1 slider step for dampers / ARB /
 *  alignment / caster. Avoids floating-point noise like 8.300000000000001. */
function step1(v: number): number {
  return Number(v.toFixed(1))
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

  // Sprung mass per corner — needed by springs AND by the build-aware
  // damper / tire-pressure scales below. Computed once if the build is
  // complete enough; falls back to the reference values otherwise so the
  // preview keeps showing usable numbers when the form is incomplete.
  const weight = typeof build.weight === 'number' ? build.weight : null
  const distPct = typeof build.weightFrontPct === 'number' ? build.weightFrontPct : null
  let sprungF = REFERENCE_SPRUNG_F
  let sprungR = REFERENCE_SPRUNG_R
  let frontDist = REFERENCE_FRONT_PCT / 100
  let buildComplete = false
  if (weight !== null && distPct !== null) {
    frontDist = clamp(distPct / 100, 0.2, 0.8)
    const sprungTotal = weight * (1 - UNSPRUNG_RATIO)
    sprungF = sprungTotal * frontDist / 2
    sprungR = sprungTotal * (1 - frontDist) / 2
    buildComplete = true
  }

  // Springs — frequency method.
  if (buildComplete) {
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

  // Build-aware multipliers — anchored to REFERENCE_*. A build matching the
  // reference produces 1.0 everywhere; lighter / heavier / narrower-tire
  // builds shift the magnitudes accordingly. Without these, dampers / ARBs /
  // tire pressure / brake balance would be flat across cars (the session
  // 19 bug: a 1035 kg RWD and a 1431 kg AWD produced near-identical tunes).
  const damperScaleF = Math.sqrt(sprungF / REFERENCE_SPRUNG_F)
  const damperScaleR = Math.sqrt(sprungR / REFERENCE_SPRUNG_R)
  const arbScale = weight !== null ? (weight / REFERENCE_TOTAL_KG) : 1.0

  // Dampers — stiffness drives magnitude; build mass drives per-axle scaling;
  // balance shifts F/R by a fixed click. FH6 step is 0.1.
  const bumpF = DAMPER_BUMP_BASE * stiff * damperScaleF
  const bumpR = DAMPER_BUMP_BASE * stiff * damperScaleR
  const rebF = DAMPER_REBOUND_BASE * stiff * damperScaleF
  const rebR = DAMPER_REBOUND_BASE * stiff * damperScaleR
  tune.bumpFront = step1(clamp(bumpF + bal, 1, 20))
  tune.bumpRear = step1(clamp(bumpR - bal, 1, 20))
  tune.reboundFront = step1(clamp(rebF + bal, 1, 20))
  tune.reboundRear = step1(clamp(rebR - bal, 1, 20))

  // ARB — stiffer end ⇒ more load transfer ⇒ less grip at that end. FH6 step is 0.1.
  // Scales linearly with total mass relative to the reference.
  tune.arbFront = step1(clamp(ARB_FRONT_BASE * stiff * (1 + 0.10 * bal) * arbScale, 1, 65))
  tune.arbRear = step1(clamp(ARB_REAR_BASE * stiff * (1 - 0.10 * bal) * arbScale, 1, 65))

  // Ride height — surface-driven; same front/rear for v1.
  const rh = RIDE_HEIGHT_IN[dials.surface]
  tune.rideHeightFront = rh
  tune.rideHeightRear = rh

  // Alignment — FH6 step is 0.1° everywhere. Display pads to 2 decimals.
  const camberF = CAMBER_FRONT_BASE[dials.surface]
  tune.camberFront = step1(clamp(camberF, -5, 5))
  tune.camberRear = step1(clamp(camberF + CAMBER_REAR_OFFSET, -5, 5))
  tune.casterFront = step1(clamp(CASTER_DEG, 1, 7))
  tune.toeFront = 0.0
  // Tight ⇒ more rear toe-in for stability; loose ⇒ less.
  tune.toeRear = step1(clamp(TOE_REAR_BASE * (1 + 0.5 * bal), -5, 5))

  // Tire pressure — surface gives the baseline; per-axle scaling by
  // corner load / tire width (relative to the reference build). Heavier
  // car-on-narrower-tire wants higher pressure; lighter-on-wider wants
  // lower. pow=0.4 keeps the magnitude sim-realistic (±~5 psi around the
  // surface baseline, not ±30%). Anchored to FH6's 0.1-bar slider notch.
  const widthF = typeof build.tireWidthFront === 'number' ? build.tireWidthFront : REFERENCE_TIRE_WIDTH_MM
  const widthR = typeof build.tireWidthRear === 'number' ? build.tireWidthRear : REFERENCE_TIRE_WIDTH_MM
  const unsprungPerCorner = weight !== null ? UNSPRUNG_RATIO * weight / 4 : REFERENCE_UNSPRUNG_PER_CORNER
  const cornerLoadF = sprungF + unsprungPerCorner
  const cornerLoadR = sprungR + unsprungPerCorner
  const tireScaleF = Math.pow(cornerLoadF / REFERENCE_CORNER_LOAD_F, TIRE_PRESSURE_LOAD_EXP)
    / Math.pow(widthF / REFERENCE_TIRE_WIDTH_MM, TIRE_PRESSURE_LOAD_EXP)
  const tireScaleR = Math.pow(cornerLoadR / REFERENCE_CORNER_LOAD_R, TIRE_PRESSURE_LOAD_EXP)
    / Math.pow(widthR / REFERENCE_TIRE_WIDTH_MM, TIRE_PRESSURE_LOAD_EXP)
  const tpBasePsi = TIRE_PRESSURE_BAR[dials.surface] * BAR_TO_PSI
  const tpF = clamp(tpBasePsi * tireScaleF, 14.5, 55.1)
  const tpR = clamp(tpBasePsi * tireScaleR, 14.5, 55.1)
  tune.tirePressureFront = Number(tpF.toFixed(4))
  tune.tirePressureRear = Number(tpR.toFixed(4))

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

  // Brakes — front bias tracks the static weight distribution + 4 % for the
  // dynamic forward weight transfer under hard braking, then ±2 % per
  // balance click. A 48 % front car (reference) ⇒ 52 % bias, matching the
  // previous flat constant. A 60 % front car ⇒ 64 % bias; a 40 % front
  // car ⇒ 44 %. Falls back to BRAKE_BALANCE_BASE when distPct is missing.
  const baseBalance = distPct !== null ? distPct + 4 : BRAKE_BALANCE_BASE
  tune.brakeBalance = clamp(Math.round(baseBalance + 2 * bal), 0, 100)
  tune.brakePressure = clamp(BRAKE_PRESSURE, 0, 200)

  // Aero — emit per-axle absolute downforce (lb canonical; displays as kgf
  // in metric). Per-car maxes vary so these are mid-range defaults the user
  // can dial to their car's slider range. Balance pref shifts ±20 lb F/R.
  const aero = typeof build.aero === 'string' ? build.aero : 'none'
  if (aero === 'splitter' || aero === 'both') {
    tune.aeroFront = Math.max(0, Math.round(AERO_FRONT_BASE_LB + 20 * bal))
  }
  if (aero === 'wing' || aero === 'both') {
    tune.aeroRear = Math.max(0, Math.round(AERO_REAR_BASE_LB - 20 * bal))
  }

  tune.notes = `Auto-baseline · ${dials.stiffness}/${dials.balance}/${dials.surface}. Seed for /tune diagnostics — drive it and refine.`

  return { tune, blockers, warnings }
}

/** Short slug for naming the generated tune ("baseline-med-neutral-road"). */
export function autoTuneSlug(dials: AutoTuneDials): string {
  const surf = dials.surface === 'cross-country' ? 'cross' : dials.surface
  return `baseline-${dials.stiffness}-${dials.balance}-${surf}`
}
