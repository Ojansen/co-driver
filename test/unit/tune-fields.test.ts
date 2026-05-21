import { describe, expect, it } from 'vitest'
import {
  TUNE_FIELDS,
  TUNE_SECTIONS,
  DEFAULT_OPEN_SECTIONS,
  getTuneField,
  tuneFieldsBySection,
  visibleTuneFields
} from '../../app/utils/tune-fields'

describe('TUNE_FIELDS metadata', () => {
  it('every field has id + label + section + kind', () => {
    for (const f of TUNE_FIELDS) {
      expect(f.id).toBeTruthy()
      expect(f.label).toBeTruthy()
      expect(f.section).toBeTruthy()
      expect(f.kind).toMatch(/^(number|enum|text)$/)
    }
  })

  it('every field section is in TUNE_SECTIONS', () => {
    const sections = new Set<string>(TUNE_SECTIONS)
    for (const f of TUNE_FIELDS) {
      expect(sections.has(f.section)).toBe(true)
    }
  })

  it('no duplicate field ids', () => {
    const ids = TUNE_FIELDS.map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every section appearing in TUNE_FIELDS has DEFAULT_OPEN_SECTIONS entry', () => {
    const sectionsInUse = new Set(TUNE_FIELDS.map(f => f.section))
    for (const s of sectionsInUse) {
      expect(s in DEFAULT_OPEN_SECTIONS).toBe(true)
    }
  })
})

describe('getTuneField', () => {
  it('finds an existing field', () => {
    expect(getTuneField('springsFront')?.label).toBe('Front springs')
  })

  it('returns undefined for unknown id', () => {
    expect(getTuneField('not_a_real_field')).toBeUndefined()
  })
})

describe('drivetrain gating', () => {
  it('FWD shows front diff fields, hides rear + center', () => {
    const ids = visibleTuneFields('fwd').map(f => f.id)
    expect(ids).toContain('frontAccel')
    expect(ids).toContain('frontDecel')
    expect(ids).not.toContain('rearAccel')
    expect(ids).not.toContain('rearDecel')
    expect(ids).not.toContain('centerBalance')
  })

  it('RWD shows rear diff fields, hides front + center', () => {
    const ids = visibleTuneFields('rwd').map(f => f.id)
    expect(ids).toContain('rearAccel')
    expect(ids).toContain('rearDecel')
    expect(ids).not.toContain('frontAccel')
    expect(ids).not.toContain('frontDecel')
    expect(ids).not.toContain('centerBalance')
  })

  it('AWD shows rear + center, hides front', () => {
    const ids = visibleTuneFields('awd').map(f => f.id)
    expect(ids).toContain('rearAccel')
    expect(ids).toContain('rearDecel')
    expect(ids).toContain('centerBalance')
    expect(ids).not.toContain('frontAccel')
    expect(ids).not.toContain('frontDecel')
  })

  it('unknown drivetrain hides all gated diff fields', () => {
    const ids = visibleTuneFields(null).map(f => f.id)
    expect(ids).not.toContain('frontAccel')
    expect(ids).not.toContain('rearAccel')
    expect(ids).not.toContain('centerBalance')
  })

  it('non-diff fields are always visible regardless of drivetrain', () => {
    const fwdIds = new Set(visibleTuneFields('fwd').map(f => f.id))
    const rwdIds = new Set(visibleTuneFields('rwd').map(f => f.id))
    const awdIds = new Set(visibleTuneFields('awd').map(f => f.id))
    for (const id of ['springsFront', 'arbRear', 'brakeBalance', 'aeroFront']) {
      expect(fwdIds.has(id)).toBe(true)
      expect(rwdIds.has(id)).toBe(true)
      expect(awdIds.has(id)).toBe(true)
    }
  })
})

describe('tuneFieldsBySection', () => {
  it('groups fields under their declared sections', () => {
    const groups = tuneFieldsBySection('rwd')
    expect(groups.springs?.length).toBe(2)
    expect(groups.dampers?.length).toBe(4)
    expect(groups.arb?.length).toBe(2)
  })

  it('differential group reflects drivetrain', () => {
    expect(tuneFieldsBySection('fwd').differential?.length).toBe(2)
    expect(tuneFieldsBySection('rwd').differential?.length).toBe(2)
    expect(tuneFieldsBySection('awd').differential?.length).toBe(3)
  })
})
