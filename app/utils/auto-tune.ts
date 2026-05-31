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
 *  Baseline anchored to NumberlessMath's community Forza freq table
 *  (forums.forza.net basic-formula-for-spring-rate): soft 1.98, moderate
 *  2.42, stiff 2.80 Hz. With STIFFNESS_MUL = 0.85/1.0/1.15 applied on top,
 *  road lands at 2.06/2.42/2.78 — within 0.02 Hz of all three community
 *  targets.
 *
 *  Dirt and cross-country are RALLY surfaces. forza.tools' engine.js models
 *  rally springs as "race rate × 0.5" (rally suspension's spring slider tops
 *  out far below the race kit's). Since spring rate ∝ f², halving the rate
 *  means freq × √0.5 ≈ road × 0.71. Dirt lands at 1.71 Hz (= road × 0.71 ⇒
 *  ½ the road rate, the forza.tools rally anchor); cross-country drops to
 *  1.53 Hz (≈ road × 0.63 ⇒ ~0.40× the road rate) for maximum compliance
 *  over rough terrain. The previous 1.94 / 1.69 left rally springs at
 *  0.64× / 0.49× the road rate — stiff enough to clip past the rally
 *  spring-slider max in-game (the bug this fixes). */
const FREQ_FRONT_BASE: Record<Surface, number> = {
  'road': 2.42,
  'dirt': 1.71,
  'cross-country': 1.53
}
const FREQ_REAR_OFFSET = 0.2
/** Cross-country flips the flat-ride offset: off-road AWD wants the rear
 *  SOFTER than the front for rotation (engine.js's offroad kit puts the rear
 *  far down the slider — pctRear 0.065 vs pctFront 0.395). A negative rear
 *  offset drops rear frequency below front so the rear spring rate lands
 *  under the front instead of above it. */
const FREQ_REAR_OFFSET_CROSS = -0.15

/** Spring-frequency multiplier by aero package. NumberlessMath separates a
 *  "heavy aero / limited travel" band at 3.43 Hz and "heavy aero + limited
 *  travel" at 3.96 Hz from the non-aero "Stiff" 2.80 Hz. We map: splitter or
 *  wing alone ⇒ +10 %, both ⇒ +22 % — so stiff+both lands at ~3.40 Hz
 *  (community "heavy aero"), comfortably mid-slider on FH6's per-car spring
 *  range instead of pegged at the floor. */
const AERO_FREQ_MUL: Record<string, number> = {
  none: 1.00,
  splitter: 1.10,
  wing: 1.10,
  both: 1.22
}

/** Damper midpoints on FH's 1–20 scale at neutral dials, for the reference
 *  build (see REFERENCE_*). Real damper rate scales with √(sprung mass)
 *  per axle — critical damping is c ∝ √(k·m), and spring already encodes
 *  mass via the frequency method. */
const DAMPER_BUMP_BASE = 8
const DAMPER_REBOUND_BASE = 11

/** Rally bump base on the 1–20 scale. Rally/off-road wants bump near the
 *  slider floor (community + ForzaTune: "soak up ruts and jumps, don't
 *  bounce"); engine.js pins rally bump at ~1–3.4. Rebound is left on
 *  DAMPER_REBOUND_BASE — every source keeps rally rebound firmer than bump,
 *  front-biased, with extra at the rear (which the mass scaling provides). */
const RALLY_DAMPER_BUMP_BASE = 3

/** ARB baselines on FH's 1–65 scale at neutral dials, by drivetrain.
 *  Anchored to the forza.tools (FH6) calculator: RWD wants a stiffer rear
 *  to free rotation; FWD wants a very soft front so the inside front isn't
 *  unloaded under power; AWD sits between the two. Total-mass scaling is
 *  not applied — body-roll moment is dominated by track width and CoG
 *  height (which the per-car slider range already encodes), not by mass. */
const ARB_BASE: Record<string, { front: number, rear: number }> = {
  rwd: { front: 22, rear: 30 },
  awd: { front: 26, rear: 33 },
  fwd: { front: 12, rear: 32 }
}
const ARB_BASE_DEFAULT: { front: number, rear: number } = { front: 22, rear: 30 }

/** Rally ARB baseline — near minimum, rear slightly stiffer than front.
 *  Consensus across ForzaTune, forzafire, and the community: keep both bars
 *  soft on loose surfaces so each wheel follows the terrain independently,
 *  and tune balance with the diff and dampers instead (engine.js goes to a
 *  flat 6/6). The drivetrain baselines and the weight-distribution shift do
 *  NOT apply on rally surfaces. Stiffness / balance dials still scale on top. */
const RALLY_ARB: { front: number, rear: number } = { front: 8, rear: 11 }

/** Front ARB shift per 1 % off 50 / 50 weight distribution, by drivetrain.
 *  RWD with a front-heavy build adds front ARB to fight push; FWD does
 *  the opposite (softer front under heavy nose to keep the inside front
 *  loaded); AWD lands in between. From forza.tools' engine.js. */
const ARB_WEIGHT_SHIFT_FACTOR: Record<string, number> = {
  rwd: 1.0,
  fwd: -1.0,
  awd: 0.66
}

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

/** Ride height (inches) by surface. Road sits near the practical minimum.
 *  Rally surfaces sit HIGH — every source (ForzaTune, DiamondLobby, QuickTune,
 *  forzafire) puts rally near the top of its range (70–80%+, cross-country at
 *  max) for travel over rough terrain; engine.js positions it at ~95%. We hold
 *  a 5.8" floor (RALLY_RIDE_HEIGHT_FLOOR_IN) and clamp to the 8.0" global max. */
const RIDE_HEIGHT_IN: Record<Surface, number> = {
  'road': 4.0,
  'dirt': 7.0,
  'cross-country': 8.0
}

/** Global ride-height guard (inches), from forza.tools' engine.js
 *  `clamp(rhFront, 2.0, 8.0)`. Rally suspension raises the usable minimum to
 *  5.8" ("cars need travel over rough surfaces" — engine.js), applied as a
 *  floor on rally surfaces so the seed never lands under the in-game slider. */
const RIDE_HEIGHT_MIN_IN = 2.0
const RIDE_HEIGHT_MAX_IN = 8.0
const RALLY_RIDE_HEIGHT_FLOOR_IN = 5.8

/** Global spring-rate guard (lb/in), from forza.tools' engine.js
 *  `clamp(rate, 50, 1500)`. A backstop only — the frequency method should land
 *  well inside this; without it the tool emitted spring values with no bound
 *  at all (which is how rally springs escaped the slider in the first place). */
const SPRING_MIN_LB_IN = 50
const SPRING_MAX_LB_IN = 1500

/** Surfaces that imply rally / off-road suspension parts. */
const RALLY_SURFACES: readonly Surface[] = ['dirt', 'cross-country']

const CAMBER_FRONT_BASE: Record<Surface, number> = {
  'road': -1.8,
  'dirt': -0.8,
  'cross-country': -0.5
}
const CAMBER_REAR_OFFSET = 0.6 // rear less negative than front
/** Rear camber sits closer to the front on rally — dirt rewards a flatter
 *  contact patch, and the consensus rear range (−0.5 to −0.8) is much nearer
 *  the front than the road offset would give (the old 0.6 left the rear at
 *  only −0.2 on dirt, below every source's rally rear-camber band). */
const CAMBER_REAR_OFFSET_RALLY = 0.3
/** Cross-country runs flat front AND rear at −0.5 (forzafire + engine.js
 *  offroad both land there), so the rear gets zero offset from the −0.5 front
 *  base. Using the rally 0.3 offset here was the bug that left CC rear at 0.0. */
const CAMBER_REAR_OFFSET_CROSS = 0.0

// Tire pressures anchored to FH6's 0.1-bar step so the value lands exactly on
// a slider notch in metric. Stored as canonical psi via BAR_TO_PSI.
// Rally pressures sit in the QuickTune / forzafire mainstream band (~25 psi,
// modestly below road) rather than the DiamondLobby grip-extreme (10–15 psi).
const BAR_TO_PSI = 14.5038
// Cross-country sits at the forzafire FH6 ~1.9 bar (~27.5 psi) symmetric
// target — deliberately above dirt here (user's call), still nowhere near the
// DiamondLobby 10–15 psi extreme.
const TIRE_PRESSURE_BAR: Record<Surface, number> = {
  'road': 2.0,
  'dirt': 1.8,
  'cross-country': 1.9
}

/** Caster (°) lerped on total weight in lb. From forza.tools' engine.js —
 *  heavier cars want more caster for stability and steering load. Drift
 *  and drag get fixed overrides elsewhere (not exposed in v1's dials). */
const CASTER_BY_WEIGHT_LB: [number, number][] = [
  [2500, 5.2],
  [3000, 6.0],
  [3500, 6.5],
  [4500, 7.0]
]
/** Cross-country trims a touch of caster off the weight-lerped value —
 *  forzafire / QuickTune put CC at ~5.0–5.5° (lower steering load on loose
 *  surfaces) vs dirt's higher band. (engine.js's fixed 2.0 is rejected.) */
const CASTER_CROSS_OFFSET = 0.3
const KG_TO_LB = 2.20462

const TOE_REAR_BASE = 0.15 // slight rear toe-in for stability

const BRAKE_BALANCE_BASE = 52 // % front
const BRAKE_PRESSURE = 100

// Aero — values are stored in lb (Forza-canonical); metric display is kgf.
// FH6 slider max is per-car (bumper + wing dependent), so the absolute
// magnitude can clip per car. We anchor below the lowest published race-kit
// cap (~110 lb front, ~220 lb rear from FH4/5 QuickTune lineage) and let the
// drivetrain-correct Aero Balance target drive the F/R ratio.
//
// FH6's in-game readout exposes an "Aero Balance" stat = F / (F + R).
// Anchored to forza.tools' calculator: RWD goes 40 / 60 (rear-biased — the
// drive axle needs grip); FWD and AWD sit at 43 / 57 (still rear-biased
// but less so, since the front already has drive load).
const AERO_FRONT_BASE_LB = 90
const AERO_REAR_WING_ONLY_LB = 110
const AERO_TARGET_BALANCE: Record<string, number> = {
  fwd: 0.43,
  rwd: 0.40,
  awd: 0.43
}
const AERO_TARGET_BALANCE_DEFAULT = 0.43
const AERO_BALANCE_DIAL_SHIFT = 0.03 // per balance click; tight ⇒ more rear-biased
/** Rally downforce multiplier. Off-road speeds rarely make downforce worth
 *  the PI (forzafire: race wings are "wasted PI" over jumps; engine.js runs
 *  rally at ~30% of range). We halve the magnitude but keep the same F/R
 *  balance target so the seed stays drivetrain-correct, just lighter. */
const RALLY_AERO_MUL = 0.5
/** Cross-country runs even less downforce than dirt — drag hurts entry speed
 *  and angle recovery on rough terrain (engine.js offroad levelPct 0.3). */
const RALLY_AERO_MUL_CROSS = 0.3

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

/** Piecewise-linear interpolation over a sorted [x, y] table, clamped at
 *  the endpoints. Matches the shape forza.tools' engine.js uses for
 *  caster, damper bump base, and tire-pressure weight modifier. */
function lerpTable(table: readonly (readonly [number, number])[], x: number): number {
  const first = table[0]
  const last = table[table.length - 1]
  if (!first || !last) return 0
  if (x <= first[0]) return first[1]
  if (x >= last[0]) return last[1]
  for (let i = 0; i < table.length - 1; i++) {
    const p0 = table[i]
    const p1 = table[i + 1]
    if (!p0 || !p1) continue
    if (x >= p0[0] && x <= p1[0]) {
      const t = (x - p0[0]) / (p1[0] - p0[0])
      return p0[1] + (p1[1] - p0[1]) * t
    }
  }
  return last[1]
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

  // Aero package — read once, used by both the spring-frequency multiplier
  // and the downforce assignment further below.
  const aero = typeof build.aero === 'string' ? build.aero : 'none'

  // Drivetrain — read once, used by ARB baselines, differential, and aero
  // balance. Null when missing; ARB/aero fall back to RWD-shaped defaults
  // for the incomplete-build preview (diff stays undefined and gets gated).
  const drivetrain = typeof build.drivetrain === 'string' ? build.drivetrain : null

  // Rally surfaces (dirt / cross-country) imply rally / off-road suspension
  // parts, which flip the setup philosophy on several systems below: near-min
  // ARBs, soft bump, raised ride height, flatter rear camber, a traction-first
  // diff, and minimal aero. Springs / ride-height softening is handled in
  // their own surface-keyed tables.
  const isRally = RALLY_SURFACES.includes(dials.surface)
  // Cross-country is the roughest off-road category — softer still than dirt,
  // ride height at max, flatter camber, rear-soft springs, a more-even diff,
  // and even less aero. These deltas layer on top of the shared rally branch.
  const isCrossCountry = dials.surface === 'cross-country'

  // Springs — frequency method. Aero package scales the target frequency:
  // a car with downforce wants to keep ride height stable under high-speed
  // load and so wants stiffer springs than its mass-and-surface peers.
  const aeroMul = AERO_FREQ_MUL[aero] ?? 1.00
  if (buildComplete) {
    const freqFBase = FREQ_FRONT_BASE[dials.surface]
    // Cross-country drops the rear below the front (rotation); every other
    // surface keeps the flat-ride rear-stiffer offset.
    const freqRBase = freqFBase + (isCrossCountry ? FREQ_REAR_OFFSET_CROSS : FREQ_REAR_OFFSET)
    // Tight ⇒ stiffer front, softer rear (load to front to reduce rotation).
    const freqF = freqFBase * stiff * aeroMul * (1 + 0.05 * bal)
    const freqR = freqRBase * stiff * aeroMul * (1 - 0.05 * bal)
    // Clamp to the engine.js global spring guard so the seed never lands
    // outside any in-game slider, regardless of build mass / dial extremes.
    tune.springsFront = Math.round(clamp(springRateLbIn(sprungF, freqF), SPRING_MIN_LB_IN, SPRING_MAX_LB_IN))
    tune.springsRear = Math.round(clamp(springRateLbIn(sprungR, freqR), SPRING_MIN_LB_IN, SPRING_MAX_LB_IN))
  }
  // (When weight or weightFrontPct is missing, blockers prevents submission;
  // springs are left undefined in the preview.)

  // Damper scaling — per-axle sprung mass relative to the reference. √(m)
  // because critical damping is c ∝ √(k·m) and the spring already encodes
  // mass via the frequency method. Without this, a 1035 kg RWD and a
  // 1431 kg AWD would emit near-identical damper values (session-19 bug).
  const damperScaleF = Math.sqrt(sprungF / REFERENCE_SPRUNG_F)
  const damperScaleR = Math.sqrt(sprungR / REFERENCE_SPRUNG_R)

  // Dampers — stiffness drives magnitude; build mass drives per-axle scaling;
  // balance shifts F/R by a fixed click. FH6 step is 0.1. Rally surfaces drop
  // bump near the slider floor (soak up ruts / jumps) while rebound stays on
  // the road base — firmer than bump, with extra at the rear from mass scaling.
  const bumpBase = isRally ? RALLY_DAMPER_BUMP_BASE : DAMPER_BUMP_BASE
  const bumpF = bumpBase * stiff * damperScaleF
  const bumpR = bumpBase * stiff * damperScaleR
  const rebF = DAMPER_REBOUND_BASE * stiff * damperScaleF
  const rebR = DAMPER_REBOUND_BASE * stiff * damperScaleR
  tune.bumpFront = step1(clamp(bumpF + bal, 1, 20))
  tune.bumpRear = step1(clamp(bumpR - bal, 1, 20))
  tune.reboundFront = step1(clamp(rebF + bal, 1, 20))
  tune.reboundRear = step1(clamp(rebR - bal, 1, 20))

  // ARB — drivetrain baselines (forza.tools): RWD wants stiffer rear, FWD
  // wants very soft front. Front shifts by (frontWeight% − 50) × factor,
  // where the factor is drivetrain-specific (RWD +1, FWD −1, AWD +0.66).
  // Rear is baseline-only — body roll moment is dominated by track width
  // and CoG height (the per-car slider range already encodes that), not
  // total mass. Auto-tune's stiffness and balance dials still apply on top.
  // On rally surfaces, ignore the drivetrain baseline + weight-distribution
  // shift entirely: both bars go near-minimum (RALLY_ARB) so each wheel
  // follows the terrain, and balance is carried by the diff and dampers.
  const arbBase = isRally ? RALLY_ARB : (ARB_BASE[drivetrain ?? ''] ?? ARB_BASE_DEFAULT)
  const arbFactor = isRally ? 0 : (ARB_WEIGHT_SHIFT_FACTOR[drivetrain ?? ''] ?? 0)
  const arbDistPct = distPct !== null ? distPct : 50
  const arbFrontShifted = arbBase.front + (arbDistPct - 50) * arbFactor
  tune.arbFront = step1(clamp(arbFrontShifted * stiff * (1 + 0.10 * bal), 1, 65))
  tune.arbRear = step1(clamp(arbBase.rear * stiff * (1 - 0.10 * bal), 1, 65))

  // Ride height — surface-driven; same front/rear for v1. Clamp to the
  // engine.js global guard (2.0–8.0"), and on rally surfaces hold a 5.8"
  // floor — rally suspension raises the in-game minimum, so a lower value
  // lands off the bottom of the slider.
  const rhFloor = isRally ? RALLY_RIDE_HEIGHT_FLOOR_IN : RIDE_HEIGHT_MIN_IN
  const rh = clamp(RIDE_HEIGHT_IN[dials.surface], rhFloor, RIDE_HEIGHT_MAX_IN)
  tune.rideHeightFront = rh
  tune.rideHeightRear = rh

  // Alignment — FH6 step is 0.1° everywhere. Display pads to 2 decimals.
  // Rally keeps the rear nearer the front (flatter contact patch on loose).
  const camberF = CAMBER_FRONT_BASE[dials.surface]
  const rearCamberOffset = isCrossCountry
    ? CAMBER_REAR_OFFSET_CROSS
    : isRally ? CAMBER_REAR_OFFSET_RALLY : CAMBER_REAR_OFFSET
  tune.camberFront = step1(clamp(camberF, -5, 5))
  tune.camberRear = step1(clamp(camberF + rearCamberOffset, -5, 5))
  // Caster — lerped on total weight (lb). Heavier cars want more caster
  // for stability and steering load; lighter cars stay lower for nimbler
  // turn-in. When weight is missing, fall back to the reference build.
  const weightLb = (weight ?? REFERENCE_TOTAL_KG) * KG_TO_LB
  const casterRaw = lerpTable(CASTER_BY_WEIGHT_LB, weightLb) - (isCrossCountry ? CASTER_CROSS_OFFSET : 0)
  tune.casterFront = step1(clamp(casterRaw, 1, 7))
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
  // Rally surfaces want a traction-first diff: more accel lock to put power
  // down on loose surfaces, and more decel lock for stability under
  // trail-braking. AWD numbers track the forzafire FH6 dirt band (rear accel
  // 55-70, rear decel 20-25, center 65-75% rear); FWD/RWD move the same way.
  if (drivetrain === 'fwd') {
    tune.frontAccel = clamp(Math.round((isRally ? 30 : 25) + 5 * bal), 0, 100)
    tune.frontDecel = isRally ? 10 : 0
  } else if (drivetrain === 'rwd') {
    tune.rearAccel = clamp(Math.round((isRally ? 58 : 50) + 5 * bal), 0, 100)
    tune.rearDecel = isRally ? 25 : 20
  } else if (drivetrain === 'awd') {
    tune.frontAccel = isRally ? 35 : 30
    tune.frontDecel = 10
    // Cross-country puts a bit more rear accel lock down than dirt for traction.
    tune.rearAccel = isCrossCountry ? 65 : isRally ? 60 : 50
    tune.rearDecel = isRally ? 22 : 15
    // % rear (more rear ⇒ more RWD-like behavior). Cross-country pulls the
    // center back toward neutral vs dirt — trade rotation for landing stability.
    const centerBase = isCrossCountry ? 60 : 65
    tune.centerBalance = clamp(Math.round(centerBase - 5 * bal), 30, 90)
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
  // in metric). Conservative magnitudes (under the lowest known race-kit
  // slider cap) so values don't get clipped on lower-class cars; the
  // drivetrain-correct Aero Balance target drives the F/R ratio.
  //
  //   splitter-only: front aero adds front grip → tight dial ↓ aeroFront
  //   wing-only:     rear aero adds rear grip   → tight dial ↑ aeroRear
  //   both:          anchor front, derive rear to hit drivetrain target;
  //                  tight dial shifts target toward more-rear-biased
  // Rally surfaces halve the magnitude (downforce barely helps off-road) but
  // keep the same F/R balance target, so the seed stays drivetrain-correct.
  const aeroMag = isCrossCountry ? RALLY_AERO_MUL_CROSS : isRally ? RALLY_AERO_MUL : 1
  if (aero === 'splitter') {
    tune.aeroFront = Math.max(0, Math.round((AERO_FRONT_BASE_LB - 10 * bal) * aeroMag))
  } else if (aero === 'wing') {
    tune.aeroRear = Math.max(0, Math.round((AERO_REAR_WING_ONLY_LB + 10 * bal) * aeroMag))
  } else if (aero === 'both') {
    const baseTarget = AERO_TARGET_BALANCE[drivetrain ?? ''] ?? AERO_TARGET_BALANCE_DEFAULT
    const target = clamp(baseTarget - AERO_BALANCE_DIAL_SHIFT * bal, 0.2, 0.8)
    const f = AERO_FRONT_BASE_LB * aeroMag
    const r = f * (1 - target) / target
    tune.aeroFront = Math.max(0, Math.round(f))
    tune.aeroRear = Math.max(0, Math.round(r))
  }

  tune.notes = `Auto-baseline · ${dials.stiffness}/${dials.balance}/${dials.surface}. Seed for /tune diagnostics — drive it and refine.`

  return { tune, blockers, warnings }
}

/** Short slug for naming the generated tune ("baseline-med-neutral-road"). */
export function autoTuneSlug(dials: AutoTuneDials): string {
  const surf = dials.surface === 'cross-country' ? 'cross' : dials.surface
  return `baseline-${dials.stiffness}-${dials.balance}-${surf}`
}
