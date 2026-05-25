import { describe, expect, it } from 'vitest'
import {
  computeAutoTune,
  autoTuneSlug,
  missingRequiredFields,
  AUTO_TUNE_REQUIRED_FIELDS,
  BALANCE_OPTIONS,
  STIFFNESS_OPTIONS,
  SURFACE_OPTIONS
} from '../../app/utils/auto-tune'
import type { BuildSettings } from '../../app/utils/build-fields'

// A representative S2 RWD road car build (close to a typical Forza tune target).
const RWD_S2_BUILD: BuildSettings = {
  weight: 1400,
  weightFrontPct: 48,
  drivetrain: 'rwd',
  aero: 'wing',
  carClass: 'S2',
  pi: 900,
  tireCompound: 'race'
}

const FWD_BUILD: BuildSettings = {
  weight: 1200,
  weightFrontPct: 62,
  drivetrain: 'fwd',
  aero: 'none'
}

const AWD_BUILD: BuildSettings = {
  weight: 1500,
  weightFrontPct: 52,
  drivetrain: 'awd',
  aero: 'both'
}

describe('computeAutoTune — output shape', () => {
  const { tune, blockers, warnings } = computeAutoTune({
    build: RWD_S2_BUILD,
    dials: { stiffness: 'medium', balance: 'neutral', surface: 'road' }
  })

  it('returns no blockers or warnings when build is complete', () => {
    expect(blockers).toEqual([])
    expect(warnings).toEqual([])
  })

  it('populates all non-drivetrain tune sections', () => {
    expect(tune.springsFront).toBeGreaterThan(0)
    expect(tune.springsRear).toBeGreaterThan(0)
    expect(tune.bumpFront).toBeDefined()
    expect(tune.reboundRear).toBeDefined()
    expect(tune.arbFront).toBeDefined()
    expect(tune.rideHeightFront).toBeDefined()
    expect(tune.camberFront).toBeDefined()
    expect(tune.toeRear).toBeDefined()
    expect(tune.tirePressureFront).toBeDefined()
    expect(tune.brakeBalance).toBeDefined()
    expect(tune.notes).toContain('Auto-baseline')
  })

  it('damper values fall inside the 1–20 FH scale', () => {
    for (const k of ['bumpFront', 'bumpRear', 'reboundFront', 'reboundRear'] as const) {
      const v = tune[k] as number
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(20)
    }
  })

  it('ARB values fall inside the 1–65 FH scale', () => {
    expect(tune.arbFront).toBeGreaterThanOrEqual(1)
    expect(tune.arbFront).toBeLessThanOrEqual(65)
    expect(tune.arbRear).toBeGreaterThanOrEqual(1)
    expect(tune.arbRear).toBeLessThanOrEqual(65)
  })
})

describe('computeAutoTune — dial response', () => {
  it('stiffer dial gives higher spring rates', () => {
    const soft = computeAutoTune({ build: RWD_S2_BUILD, dials: { stiffness: 'soft', balance: 'neutral', surface: 'road' } }).tune
    const stiff = computeAutoTune({ build: RWD_S2_BUILD, dials: { stiffness: 'stiff', balance: 'neutral', surface: 'road' } }).tune
    expect(stiff.springsFront).toBeGreaterThan(soft.springsFront as number)
    expect(stiff.springsRear).toBeGreaterThan(soft.springsRear as number)
  })

  it('tight balance ⇒ stiffer front + softer rear (vs loose)', () => {
    const loose = computeAutoTune({ build: RWD_S2_BUILD, dials: { stiffness: 'medium', balance: 'loose', surface: 'road' } }).tune
    const tight = computeAutoTune({ build: RWD_S2_BUILD, dials: { stiffness: 'medium', balance: 'tight', surface: 'road' } }).tune
    expect(tight.springsFront).toBeGreaterThan(loose.springsFront as number)
    expect(tight.springsRear).toBeLessThan(loose.springsRear as number)
    expect(tight.arbFront).toBeGreaterThan(loose.arbFront as number)
    expect(tight.arbRear).toBeLessThan(loose.arbRear as number)
  })

  it('tight balance ⇒ more front brake bias + more rear toe-in', () => {
    const loose = computeAutoTune({ build: RWD_S2_BUILD, dials: { stiffness: 'medium', balance: 'loose', surface: 'road' } }).tune
    const tight = computeAutoTune({ build: RWD_S2_BUILD, dials: { stiffness: 'medium', balance: 'tight', surface: 'road' } }).tune
    expect(tight.brakeBalance).toBeGreaterThan(loose.brakeBalance as number)
    expect(tight.toeRear).toBeGreaterThan(loose.toeRear as number)
  })

  it('dirt + cross-country raise ride height and drop tire pressure vs road', () => {
    const road = computeAutoTune({ build: RWD_S2_BUILD, dials: { stiffness: 'medium', balance: 'neutral', surface: 'road' } }).tune
    const dirt = computeAutoTune({ build: RWD_S2_BUILD, dials: { stiffness: 'medium', balance: 'neutral', surface: 'dirt' } }).tune
    const cross = computeAutoTune({ build: RWD_S2_BUILD, dials: { stiffness: 'medium', balance: 'neutral', surface: 'cross-country' } }).tune
    expect(dirt.rideHeightFront).toBeGreaterThan(road.rideHeightFront as number)
    expect(cross.rideHeightFront).toBeGreaterThan(dirt.rideHeightFront as number)
    expect(dirt.tirePressureFront).toBeLessThan(road.tirePressureFront as number)
  })
})

describe('computeAutoTune — drivetrain gating', () => {
  const dials = { stiffness: 'medium' as const, balance: 'neutral' as const, surface: 'road' as const }

  it('FWD sets only front-diff fields', () => {
    const { tune } = computeAutoTune({ build: FWD_BUILD, dials })
    expect(tune.frontAccel).toBeDefined()
    expect(tune.frontDecel).toBeDefined()
    expect(tune.rearAccel).toBeUndefined()
    expect(tune.rearDecel).toBeUndefined()
    expect(tune.centerBalance).toBeUndefined()
  })

  it('RWD sets only rear-diff fields', () => {
    const { tune } = computeAutoTune({ build: RWD_S2_BUILD, dials })
    expect(tune.rearAccel).toBeDefined()
    expect(tune.rearDecel).toBeDefined()
    expect(tune.frontAccel).toBeUndefined()
    expect(tune.frontDecel).toBeUndefined()
    expect(tune.centerBalance).toBeUndefined()
  })

  it('AWD sets front + rear + center', () => {
    const { tune } = computeAutoTune({ build: AWD_BUILD, dials })
    expect(tune.frontAccel).toBeDefined()
    expect(tune.rearAccel).toBeDefined()
    expect(tune.centerBalance).toBeDefined()
  })

  it('blocks generation when drivetrain is missing', () => {
    const { tune, blockers } = computeAutoTune({
      build: { weight: 1300, weightFrontPct: 50 },
      dials
    })
    expect(tune.frontAccel).toBeUndefined()
    expect(tune.rearAccel).toBeUndefined()
    expect(blockers.some(b => b.includes('Drivetrain'))).toBe(true)
  })
})

describe('computeAutoTune — required-field gating', () => {
  const dials = { stiffness: 'medium' as const, balance: 'neutral' as const, surface: 'road' as const }

  it('lists all three blockers for an empty build', () => {
    const { blockers } = computeAutoTune({ build: {}, dials })
    expect(blockers).toHaveLength(3)
    expect(blockers.some(b => b.includes('Weight') && !b.includes('distribution'))).toBe(true)
    expect(blockers.some(b => b.includes('Weight distribution'))).toBe(true)
    expect(blockers.some(b => b.includes('Drivetrain'))).toBe(true)
  })

  it('blocks when only weight is missing', () => {
    const { tune, blockers } = computeAutoTune({
      build: { weightFrontPct: 50, drivetrain: 'rwd' },
      dials
    })
    expect(tune.springsFront).toBeUndefined()
    expect(blockers.some(b => b.includes('Weight') && !b.includes('distribution'))).toBe(true)
    expect(blockers).toHaveLength(1)
  })

  it('blocks when only distribution is missing', () => {
    const { tune, blockers } = computeAutoTune({
      build: { weight: 1300, drivetrain: 'rwd' },
      dials
    })
    expect(tune.springsFront).toBeUndefined()
    expect(blockers.some(b => b.includes('Weight distribution'))).toBe(true)
  })

  it('still produces a preview tune for non-required sections when blocked', () => {
    // Damper / ARB / ride height / camber / tire pressure / brake are dial-only;
    // they fill in so the user can see what's coming once they fix the build.
    const { tune, blockers } = computeAutoTune({ build: {}, dials })
    expect(blockers.length).toBeGreaterThan(0)
    expect(tune.bumpFront).toBeDefined()
    expect(tune.arbFront).toBeDefined()
    expect(tune.rideHeightFront).toBeDefined()
    expect(tune.brakeBalance).toBeDefined()
  })

  it('omits aero values when build has no aero', () => {
    const { tune } = computeAutoTune({
      build: { ...RWD_S2_BUILD, aero: 'none' },
      dials
    })
    expect(tune.aeroFront).toBeUndefined()
    expect(tune.aeroRear).toBeUndefined()
  })

  it('emits rear aero only when build has wing only', () => {
    const { tune } = computeAutoTune({
      build: { ...RWD_S2_BUILD, aero: 'wing' },
      dials
    })
    expect(tune.aeroFront).toBeUndefined()
    expect(tune.aeroRear).toBeGreaterThan(0)
  })

  it('emits front aero only when build has splitter only', () => {
    const { tune } = computeAutoTune({
      build: { ...RWD_S2_BUILD, aero: 'splitter' },
      dials
    })
    expect(tune.aeroFront).toBeGreaterThan(0)
    expect(tune.aeroRear).toBeUndefined()
  })

  it('emits front + rear when build has both', () => {
    const { tune } = computeAutoTune({
      build: { ...RWD_S2_BUILD, aero: 'both' },
      dials
    })
    expect(tune.aeroFront).toBeGreaterThan(0)
    expect(tune.aeroRear).toBeGreaterThan(0)
  })

  it('balance dial shifts aero front-rear distribution', () => {
    const loose = computeAutoTune({ build: { ...RWD_S2_BUILD, aero: 'both' }, dials: { ...dials, balance: 'loose' } }).tune
    const tight = computeAutoTune({ build: { ...RWD_S2_BUILD, aero: 'both' }, dials: { ...dials, balance: 'tight' } }).tune
    expect(tight.aeroFront).toBeGreaterThan(loose.aeroFront as number)
    expect(tight.aeroRear).toBeLessThan(loose.aeroRear as number)
  })

  it('never emits a legacy aeroBalance field', () => {
    const { tune } = computeAutoTune({ build: RWD_S2_BUILD, dials })
    expect((tune as Record<string, unknown>).aeroBalance).toBeUndefined()
  })
})

describe('missingRequiredFields helper', () => {
  it('returns empty for a complete build', () => {
    expect(missingRequiredFields(RWD_S2_BUILD)).toEqual([])
  })

  it('lists all three for an empty build', () => {
    const missing = missingRequiredFields({})
    expect(missing).toHaveLength(3)
  })

  it('treats null and empty string as missing', () => {
    expect(missingRequiredFields({ weight: null, weightFrontPct: 50, drivetrain: 'rwd' })).toHaveLength(1)
    expect(missingRequiredFields({ weight: 1300, weightFrontPct: 50, drivetrain: '' })).toHaveLength(1)
  })

  it('exposes the required-field id list', () => {
    expect(AUTO_TUNE_REQUIRED_FIELDS).toEqual(['weight', 'weightFrontPct', 'drivetrain'])
  })
})

describe('computeAutoTune — spring math sanity', () => {
  it('S2 1400 kg / 48F at medium-neutral-road lands in a plausible lb/in range', () => {
    // Sprung mass per corner ≈ 1400·0.87·0.48/2 ≈ 292 kg front, 317 kg rear.
    // @ 2.0 Hz: k_N/mm ≈ (12.57)²·292/1000 ≈ 46 → ≈ 263 lb/in. Same form for rear.
    const { tune } = computeAutoTune({
      build: RWD_S2_BUILD,
      dials: { stiffness: 'medium', balance: 'neutral', surface: 'road' }
    })
    expect(tune.springsFront).toBeGreaterThan(200)
    expect(tune.springsFront).toBeLessThan(400)
    expect(tune.springsRear).toBeGreaterThan(250)
    expect(tune.springsRear).toBeLessThan(500)
  })
})

describe('computeAutoTune — FH6 slider precision and ranges', () => {
  const dials = { stiffness: 'medium' as const, balance: 'tight' as const, surface: 'road' as const }

  it('emits dampers at 0.1 step (not forced to integer)', () => {
    const { tune } = computeAutoTune({ build: RWD_S2_BUILD, dials })
    // With stiff=1.0 and bal=+1, bump becomes 9 (integer) but rebound shifts
    // to 12 ± 1. Pick a configuration that actually exercises the fractional
    // path so we know the step1 helper landed.
    const soft = computeAutoTune({ build: RWD_S2_BUILD, dials: { ...dials, stiffness: 'soft' } }).tune
    // soft stiff (0.85) * bump_base (8) = 6.8, + bal 1 = 7.8
    expect(soft.bumpFront).toBeCloseTo(7.8, 5)
    // damper-rear at soft + tight = 6.8 - 1 = 5.8
    expect(soft.bumpRear).toBeCloseTo(5.8, 5)
    // And every value stays inside FH6's 1.0–20.0 window.
    for (const k of ['bumpFront', 'bumpRear', 'reboundFront', 'reboundRear'] as const) {
      expect(tune[k] as number).toBeGreaterThanOrEqual(1)
      expect(tune[k] as number).toBeLessThanOrEqual(20)
    }
  })

  it('emits ARB at 0.1 step within FH6 1.0–65.0', () => {
    const soft = computeAutoTune({ build: RWD_S2_BUILD, dials: { ...dials, stiffness: 'soft' } }).tune
    // arbFront base 30 * 0.85 * (1 + 0.1·1) = 28.05 → 28.1
    expect(soft.arbFront).toBeCloseTo(28.1, 5)
    expect(soft.arbFront).toBeGreaterThanOrEqual(1)
    expect(soft.arbFront).toBeLessThanOrEqual(65)
  })

  it('alignment values respect FH6 ranges (±5° camber/toe, 1–7° caster)', () => {
    const { tune } = computeAutoTune({ build: RWD_S2_BUILD, dials })
    expect(tune.camberFront).toBeGreaterThanOrEqual(-5)
    expect(tune.camberFront).toBeLessThanOrEqual(5)
    expect(tune.casterFront).toBeGreaterThanOrEqual(1)
    expect(tune.casterFront).toBeLessThanOrEqual(7)
    expect(tune.toeRear).toBeGreaterThanOrEqual(-5)
    expect(tune.toeRear).toBeLessThanOrEqual(5)
  })

  it('tire pressure stays inside FH6 14.5–55.1 psi (= 1.0–3.8 bar)', () => {
    for (const surface of ['road', 'dirt', 'cross-country'] as const) {
      const { tune } = computeAutoTune({
        build: RWD_S2_BUILD,
        dials: { ...dials, surface }
      })
      expect(tune.tirePressureFront).toBeGreaterThanOrEqual(14.5)
      expect(tune.tirePressureFront).toBeLessThanOrEqual(55.1)
    }
  })
})

describe('computeAutoTune — build-aware fields (regression for session-19 bug)', () => {
  // Same dials across every test in this block — the differences come from
  // the build alone. Without per-build scaling on dampers / ARB / tire
  // pressure / brake balance, two structurally different builds produced
  // near-identical tunes (see tunes 7 & 8 in the dev DB, 2026-05-25).
  const dials = { stiffness: 'medium' as const, balance: 'neutral' as const, surface: 'road' as const }

  const lightCar: BuildSettings = {
    weight: 1000, weightFrontPct: 45, drivetrain: 'rwd',
    tireWidthFront: 245, tireWidthRear: 245
  }
  const heavyCar: BuildSettings = {
    weight: 1500, weightFrontPct: 50, drivetrain: 'rwd',
    tireWidthFront: 245, tireWidthRear: 245
  }

  it('dampers scale with per-axle sprung mass (heavier ⇒ stiffer dampers)', () => {
    const light = computeAutoTune({ build: lightCar, dials }).tune
    const heavy = computeAutoTune({ build: heavyCar, dials }).tune
    expect(heavy.bumpFront).toBeGreaterThan(light.bumpFront as number)
    expect(heavy.bumpRear).toBeGreaterThan(light.bumpRear as number)
    expect(heavy.reboundFront).toBeGreaterThan(light.reboundFront as number)
    expect(heavy.reboundRear).toBeGreaterThan(light.reboundRear as number)
  })

  it('ARB scales with total mass (heavier ⇒ stiffer ARB)', () => {
    const light = computeAutoTune({ build: lightCar, dials }).tune
    const heavy = computeAutoTune({ build: heavyCar, dials }).tune
    expect(heavy.arbFront).toBeGreaterThan(light.arbFront as number)
    expect(heavy.arbRear).toBeGreaterThan(light.arbRear as number)
  })

  it('brake balance tracks static weight distribution', () => {
    const frontHeavy = computeAutoTune({ build: { ...lightCar, weightFrontPct: 62 }, dials }).tune
    const rearHeavy = computeAutoTune({ build: { ...lightCar, weightFrontPct: 38 }, dials }).tune
    // 62 % front ⇒ ~66 % brake bias (front transfer adds ~4 %)
    // 38 % front ⇒ ~42 % brake bias
    expect(frontHeavy.brakeBalance).toBeGreaterThan(rearHeavy.brakeBalance as number)
    // ~24 pp spread is the load-bearing assertion (linear with distPct).
    expect((frontHeavy.brakeBalance as number) - (rearHeavy.brakeBalance as number))
      .toBeGreaterThanOrEqual(20)
  })

  it('tire pressure scales with corner load (heavier ⇒ higher pressure)', () => {
    const light = computeAutoTune({ build: lightCar, dials }).tune
    const heavy = computeAutoTune({ build: heavyCar, dials }).tune
    expect(heavy.tirePressureFront).toBeGreaterThan(light.tirePressureFront as number)
    expect(heavy.tirePressureRear).toBeGreaterThan(light.tirePressureRear as number)
  })

  it('tire pressure inversely scales with tire width (narrower ⇒ higher pressure)', () => {
    const narrow = computeAutoTune({
      build: { ...heavyCar, tireWidthFront: 195, tireWidthRear: 195 },
      dials
    }).tune
    const wide = computeAutoTune({
      build: { ...heavyCar, tireWidthFront: 335, tireWidthRear: 335 },
      dials
    }).tune
    expect(narrow.tirePressureFront).toBeGreaterThan(wide.tirePressureFront as number)
    expect(narrow.tirePressureRear).toBeGreaterThan(wide.tirePressureRear as number)
  })

  it('the actual session-19 builds (1035 kg RWD vs 1431 kg AWD) produce noticeably different tunes', () => {
    // These are the real numbers from the dev DB. Before this fix the
    // emitted tunes differed only in springs and diff fields — everything
    // else was flat. After the fix the dampers / ARB / brake balance /
    // tire pressure all move with the build too.
    const lightRwd: BuildSettings = {
      weight: 1035, weightFrontPct: 44, drivetrain: 'rwd',
      tireWidthFront: 245, tireWidthRear: 305
    }
    const heavyAwd: BuildSettings = {
      weight: 1431, weightFrontPct: 45, drivetrain: 'awd',
      tireWidthFront: 245, tireWidthRear: 335
    }
    const a = computeAutoTune({ build: lightRwd, dials }).tune
    const b = computeAutoTune({ build: heavyAwd, dials }).tune

    // Springs already worked pre-fix — keep asserting it.
    expect(Math.abs((a.springsFront as number) - (b.springsFront as number))).toBeGreaterThan(20)
    // The four fields the fix targets:
    expect(Math.abs((a.bumpFront as number) - (b.bumpFront as number))).toBeGreaterThan(0.5)
    expect(Math.abs((a.reboundRear as number) - (b.reboundRear as number))).toBeGreaterThan(0.5)
    expect(Math.abs((a.arbFront as number) - (b.arbFront as number))).toBeGreaterThan(2)
    expect(Math.abs((a.tirePressureFront as number) - (b.tirePressureFront as number)))
      .toBeGreaterThan(1)
    expect(Math.abs((a.brakeBalance as number) - (b.brakeBalance as number)))
      .toBeGreaterThanOrEqual(1)
  })

  it('falls back to reference scaling when build is incomplete', () => {
    // Damper / ARB / tire-pressure preview values should still appear even
    // though springs are blocked — they fall back to the reference
    // multipliers (= 1.0) rather than NaN-ing out.
    const { tune, blockers } = computeAutoTune({ build: {}, dials })
    expect(blockers.length).toBeGreaterThan(0)
    expect(tune.bumpFront).toBeDefined()
    expect(tune.bumpFront).toBeGreaterThan(0)
    expect(tune.arbFront).toBeDefined()
    expect(tune.tirePressureFront).toBeDefined()
    expect(tune.brakeBalance).toBeDefined()
    expect(Number.isFinite(tune.bumpFront)).toBe(true)
    expect(Number.isFinite(tune.tirePressureFront)).toBe(true)
  })

  it('the reference build produces the same numeric output as the previous flat path', () => {
    // RWD_S2_BUILD is intentionally aligned to REFERENCE_TOTAL_KG / FRONT_PCT,
    // so the build-aware multipliers all resolve to 1.0 and the dial-only
    // math falls through unchanged. This anchors the precision tests.
    const { tune } = computeAutoTune({
      build: RWD_S2_BUILD,
      dials: { stiffness: 'medium', balance: 'neutral', surface: 'road' }
    })
    // bump = 8 * 1.0 * 1.0 + 0 = 8 (exactly)
    expect(tune.bumpFront).toBe(8)
    expect(tune.bumpRear).toBe(8)
    // arbFront = 30 * 1.0 * 1.0 * 1.0 = 30
    expect(tune.arbFront).toBe(30)
    expect(tune.arbRear).toBe(28)
    // brakeBalance = 48 + 4 + 0 = 52 (matches pre-fix flat value)
    expect(tune.brakeBalance).toBe(52)
  })
})

describe('autoTuneSlug', () => {
  it('generates a short kebab-case identifier', () => {
    expect(autoTuneSlug({ stiffness: 'medium', balance: 'neutral', surface: 'road' })).toBe('baseline-medium-neutral-road')
    expect(autoTuneSlug({ stiffness: 'stiff', balance: 'tight', surface: 'cross-country' })).toBe('baseline-stiff-tight-cross')
  })
})

describe('option lists', () => {
  it('expose all three dial axes', () => {
    expect(STIFFNESS_OPTIONS).toEqual(['soft', 'medium', 'stiff'])
    expect(BALANCE_OPTIONS).toEqual(['loose', 'neutral', 'tight'])
    expect(SURFACE_OPTIONS).toEqual(['road', 'dirt', 'cross-country'])
  })
})
