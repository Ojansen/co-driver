/**
 * Tune field metadata — the slider-side configuration that lives on top of
 * a Build. Mirrors `/tune/*` reference page structure. Phase 1b ships this
 * alongside `app/utils/build-fields.ts`.
 *
 * Stored in Forza's native units (lb/in for springs, psi for tire pressure,
 * inches for ride height, lb for downforce, degrees for alignment). Fields
 * carrying `unitCategory` have their displayed unit driven by useUnits
 * prefs — storage stays canonical. Drivetrain-gated fields (differential)
 * are filtered by the parent build's drivetrain at render time.
 */

import type { SetupField } from './build-fields'

/** Drivetrain visibility for a tune field — limits which builds show it. */
export type DrivetrainGate = 'fwd' | 'rwd' | 'awd' | Array<'fwd' | 'rwd' | 'awd'>

export interface TuneField extends SetupField {
  /** If set, only render this field when the parent build's drivetrain matches. */
  requiresDrivetrain?: DrivetrainGate
}

const ALL_DRIVETRAINS = ['fwd', 'rwd', 'awd'] as const

function isVisible(gate: DrivetrainGate | undefined, drivetrain: string | null | undefined): boolean {
  if (!gate) return true
  const allowed = Array.isArray(gate) ? gate : [gate]
  if (!drivetrain) return false // unknown drivetrain → hide gated fields
  return (allowed as readonly string[]).includes(drivetrain)
}

export function visibleTuneFields(drivetrain: string | null | undefined): TuneField[] {
  return TUNE_FIELDS.filter(f => isVisible(f.requiresDrivetrain, drivetrain))
}

/** Logical section ordering for the form layout. */
export const TUNE_SECTIONS = [
  'springs',
  'dampers',
  'arb',
  'rideHeight',
  'alignment',
  'tirePressure',
  'differential',
  'brakes',
  'aero',
  'gears',
  'notes'
] as const

/** Sections expanded by default in TuneForm — the most-edited ones. */
export const DEFAULT_OPEN_SECTIONS: Readonly<Record<typeof TUNE_SECTIONS[number], boolean>> = {
  springs: true,
  dampers: true,
  arb: true,
  rideHeight: false,
  alignment: false,
  tirePressure: false,
  differential: false,
  brakes: true,
  aero: false,
  gears: false,
  notes: false
}

export const SECTION_LABELS: Record<typeof TUNE_SECTIONS[number], string> = {
  springs: 'Springs',
  dampers: 'Dampers',
  arb: 'Anti-roll bars',
  rideHeight: 'Ride height',
  alignment: 'Alignment',
  tirePressure: 'Tire pressure',
  differential: 'Differential',
  brakes: 'Brakes',
  aero: 'Aero',
  gears: 'Gearing',
  notes: 'Notes'
}

export const TUNE_FIELDS: readonly TuneField[] = [
  // Springs — stored in lb/in (Forza native); displayed via unit pref
  { id: 'springsFront', label: 'Front springs', section: 'springs', kind: 'number', unitCategory: 'springRate', tuneRef: 'springs' },
  { id: 'springsRear', label: 'Rear springs', section: 'springs', kind: 'number', unitCategory: 'springRate', tuneRef: 'springs' },

  // Dampers (1–20 scale)
  { id: 'bumpFront', label: 'Bump front', section: 'dampers', kind: 'number', tuneRef: 'dampers' },
  { id: 'bumpRear', label: 'Bump rear', section: 'dampers', kind: 'number', tuneRef: 'dampers' },
  { id: 'reboundFront', label: 'Rebound front', section: 'dampers', kind: 'number', tuneRef: 'dampers' },
  { id: 'reboundRear', label: 'Rebound rear', section: 'dampers', kind: 'number', tuneRef: 'dampers' },

  // Anti-roll bars
  { id: 'arbFront', label: 'Front ARB', section: 'arb', kind: 'number', tuneRef: 'anti-roll-bars' },
  { id: 'arbRear', label: 'Rear ARB', section: 'arb', kind: 'number', tuneRef: 'anti-roll-bars' },

  // Ride height — stored in inches (Forza native); displayed via unit pref
  { id: 'rideHeightFront', label: 'Front ride height', section: 'rideHeight', kind: 'number', unitCategory: 'distanceShortIn', tuneRef: 'ride-height' },
  { id: 'rideHeightRear', label: 'Rear ride height', section: 'rideHeight', kind: 'number', unitCategory: 'distanceShortIn', tuneRef: 'ride-height' },

  // Alignment (degrees)
  { id: 'camberFront', label: 'Front camber', section: 'alignment', kind: 'number', unit: '°', tuneRef: 'alignment' },
  { id: 'camberRear', label: 'Rear camber', section: 'alignment', kind: 'number', unit: '°', tuneRef: 'alignment' },
  { id: 'casterFront', label: 'Caster', section: 'alignment', kind: 'number', unit: '°', tuneRef: 'alignment' },
  { id: 'toeFront', label: 'Front toe', section: 'alignment', kind: 'number', unit: '°', tuneRef: 'alignment' },
  { id: 'toeRear', label: 'Rear toe', section: 'alignment', kind: 'number', unit: '°', tuneRef: 'alignment' },

  // Tire pressure — stored in psi (Forza native); displayed via unit pref
  { id: 'tirePressureFront', label: 'Front pressure', section: 'tirePressure', kind: 'number', unitCategory: 'pressure', tuneRef: 'tire-pressure' },
  { id: 'tirePressureRear', label: 'Rear pressure', section: 'tirePressure', kind: 'number', unitCategory: 'pressure', tuneRef: 'tire-pressure' },

  // Differential (%) — drivetrain-gated
  { id: 'frontAccel', label: 'Front accel', section: 'differential', kind: 'number', unit: '%', requiresDrivetrain: 'fwd', tuneRef: 'differential' },
  { id: 'frontDecel', label: 'Front decel', section: 'differential', kind: 'number', unit: '%', requiresDrivetrain: 'fwd', tuneRef: 'differential' },
  { id: 'rearAccel', label: 'Rear accel', section: 'differential', kind: 'number', unit: '%', requiresDrivetrain: ['rwd', 'awd'], tuneRef: 'differential' },
  { id: 'rearDecel', label: 'Rear decel', section: 'differential', kind: 'number', unit: '%', requiresDrivetrain: ['rwd', 'awd'], tuneRef: 'differential' },
  { id: 'centerBalance', label: 'Center balance', section: 'differential', kind: 'number', unit: '% rear', requiresDrivetrain: 'awd', tuneRef: 'center-diff' },

  // Brakes (%)
  { id: 'brakeBalance', label: 'Brake balance', section: 'brakes', kind: 'number', unit: '% front', tuneRef: 'brakes' },
  { id: 'brakePressure', label: 'Brake pressure', section: 'brakes', kind: 'number', unit: '%', tuneRef: 'brakes' },

  // Aero — downforce stored in lb (Forza native); displayed via unit pref
  { id: 'aeroFront', label: 'Front aero', section: 'aero', kind: 'number', unitCategory: 'downforce', tuneRef: 'aero' },
  { id: 'aeroRear', label: 'Rear aero', section: 'aero', kind: 'number', unitCategory: 'downforce', tuneRef: 'aero' },
  { id: 'aeroBalance', label: 'Aero balance', section: 'aero', kind: 'number', unit: '% front', tuneRef: 'aero' },

  // Gearing — final drive only in v1; per-gear ratios deferred.
  { id: 'finalDrive', label: 'Final drive', section: 'gears', kind: 'number', tuneRef: 'gearing' },

  // Freeform
  { id: 'notes', label: 'Notes', section: 'notes', kind: 'text' }
] as const

export function getTuneField(id: string): TuneField | undefined {
  return TUNE_FIELDS.find(f => f.id === id)
}

export function tuneFieldsBySection(drivetrain: string | null | undefined): Record<string, TuneField[]> {
  const out: Record<string, TuneField[]> = {}
  for (const f of visibleTuneFields(drivetrain)) {
    if (!out[f.section]) out[f.section] = []
    out[f.section]!.push(f)
  }
  return out
}

/** TuneSettings — derived from TUNE_FIELDS to stay in sync. */
export type TuneSettings = Partial<Record<typeof TUNE_FIELDS[number]['id'], string | number | null>>

// Re-export ALL_DRIVETRAINS for test fixtures.
export { ALL_DRIVETRAINS }
