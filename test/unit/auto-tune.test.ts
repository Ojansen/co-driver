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

  it('omits aero balance when build has no aero', () => {
    const { tune } = computeAutoTune({
      build: { ...RWD_S2_BUILD, aero: 'none' },
      dials
    })
    expect(tune.aeroBalance).toBeUndefined()
  })

  it('emits aero balance when build has aero', () => {
    const { tune } = computeAutoTune({ build: RWD_S2_BUILD, dials })
    expect(tune.aeroBalance).toBeDefined()
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
