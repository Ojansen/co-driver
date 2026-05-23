/**
 * Setup field metadata. Phase 1 ships the BUILD section; Phase 1b will
 * append TUNE field metadata to this same module.
 *
 * The fields are ForzaTune-aligned *calculation inputs* / vehicle specs,
 * not an exhaustive upgrade catalog. See WISHLIST.md / the plan file for
 * the philosophy: measurement-not-prescription, player-centric language,
 * build = the outcomes of upgrade choices.
 */

export type FieldKind = 'number' | 'enum' | 'text'

/** Discriminator for fields whose displayed unit follows the user's
 *  preferences (see app/composables/useUnits.ts). When set, the form/display
 *  layer reads `unitLabel[unitCategory]` for the suffix and round-trips
 *  values through `toDisplay`/`fromDisplay` of the same name. */
export type UnitCategory = 'pressure' | 'springRate' | 'distanceShortIn' | 'downforce'

/**
 * How a field's default value gets pre-filled when the form opens.
 * The form is responsible for resolving these sources; this module just
 * declares them.
 */
export type AutoSource = 'dyno_peak_power' | 'session_pi' | 'car_class' | 'car_drivetrain'

export interface SetupField {
  /** Stable identifier; also the JSON path under `build.*`. */
  id: string
  /** Player-centric label rendered in the form + display. Neutral
   *  language: "Tire compound" not "Best tire compound." */
  label: string
  /** Section name — for Phase 1b grouping; v1 renders everything under
   *  the single "Build" group, but the field declarations carry the
   *  intended section so the metadata is forwards-compatible. */
  section: string
  /** Kind of input. */
  kind: FieldKind
  /** Optional units suffix shown next to the field (" HP", " kg",
   *  " mm", " % front"). Used for fields that don't switch with the user's
   *  unit preferences. For switchable units (pressure, springs, ride height,
   *  downforce) set `unitCategory` instead so the form/display layer can
   *  apply the correct conversion + suffix. */
  unit?: string
  /** When set, this field's storage unit is Forza-canonical but the
   *  displayed unit follows useUnits prefs. See `UnitCategory` above. */
  unitCategory?: UnitCategory
  /** For enum fields: the allowed values in display order. */
  options?: readonly string[]
  /** Auto-populate source if this field can pre-fill from existing data. */
  auto?: AutoSource
  /** Optional /tune reference page slug for "see also" linking. */
  tuneRef?: string
}

export const BUILD_FIELDS: readonly SetupField[] = [
  {
    id: 'power',
    label: 'Power',
    section: 'engine',
    kind: 'number',
    unit: ' HP',
    auto: 'dyno_peak_power'
  },
  {
    id: 'weight',
    label: 'Weight',
    section: 'chassis',
    kind: 'number',
    unit: ' kg'
  },
  {
    id: 'weightFrontPct',
    label: 'Weight distribution',
    section: 'chassis',
    kind: 'number',
    unit: ' % front'
  },
  {
    id: 'pi',
    label: 'PI',
    section: 'class',
    kind: 'number',
    auto: 'session_pi'
  },
  {
    id: 'carClass',
    label: 'Class',
    section: 'class',
    kind: 'enum',
    options: ['D', 'C', 'B', 'A', 'S1', 'S2', 'X', 'R'],
    auto: 'car_class'
  },
  {
    id: 'drivetrain',
    label: 'Drivetrain',
    section: 'engine',
    kind: 'enum',
    options: ['fwd', 'rwd', 'awd'],
    auto: 'car_drivetrain'
  },
  {
    id: 'tireCompound',
    label: 'Tire compound',
    section: 'tires',
    kind: 'enum',
    options: ['stock', 'street', 'sport', 'semi_slick', 'race', 'rally', 'drag', 'off_road'],
    tuneRef: 'tire-pressure'
  },
  {
    id: 'tireWidthFront',
    label: 'Front tire width',
    section: 'tires',
    kind: 'number',
    unit: ' mm'
  },
  {
    id: 'tireWidthRear',
    label: 'Rear tire width',
    section: 'tires',
    kind: 'number',
    unit: ' mm'
  },
  {
    id: 'aero',
    label: 'Aero',
    section: 'aero',
    kind: 'enum',
    options: ['none', 'splitter', 'wing', 'both'],
    tuneRef: 'aero'
  },
  {
    id: 'engineSwap',
    label: 'Engine swap',
    section: 'engine',
    kind: 'text'
  },
  {
    id: 'notes',
    label: 'Notes',
    section: 'misc',
    kind: 'text'
  }
] as const

export function getBuildField(id: string): SetupField | undefined {
  return BUILD_FIELDS.find(f => f.id === id)
}

/** Map of carClass options for display formatting. */
export const CLASS_LABELS: Record<string, string> = {
  D: 'D', C: 'C', B: 'B', A: 'A', S1: 'S1', S2: 'S2', X: 'X', R: 'R'
}

/** Map of drivetrain enum to display strings. */
export const DRIVETRAIN_LABELS: Record<string, string> = {
  fwd: 'FWD', rwd: 'RWD', awd: 'AWD'
}

/** Map of tire compound enum to display strings. */
export const TIRE_COMPOUND_LABELS: Record<string, string> = {
  stock: 'Stock',
  street: 'Street',
  sport: 'Sport',
  semi_slick: 'Semi-slick',
  race: 'Race',
  rally: 'Rally',
  drag: 'Drag',
  off_road: 'Off-road'
}

/** Map of aero enum to display strings. */
export const AERO_LABELS: Record<string, string> = {
  none: 'None',
  splitter: 'Front splitter',
  wing: 'Rear wing',
  both: 'Splitter + wing'
}

/** Format a field's value for SetupDisplay. Returns '—' for nullish.
 *  When the field carries a `unitCategory` and `unitFmt` is supplied, the
 *  value is converted to the user's preferred display unit and the matching
 *  suffix is appended. */
export function formatFieldValue(
  field: SetupField,
  value: unknown,
  unitFmt?: {
    pressure: (psi: number) => string
    springRate: (lbPerIn: number) => string
    /** distanceShort takes meters — see useUnits.format.distanceShort */
    distanceShort: (meters: number) => string
    downforce: (lb: number) => string
  }
): string {
  if (value === null || value === undefined || value === '') return '—'

  if (field.kind === 'enum') {
    const stringValue = String(value)
    switch (field.id) {
      case 'carClass': return CLASS_LABELS[stringValue] ?? stringValue
      case 'drivetrain': return DRIVETRAIN_LABELS[stringValue] ?? stringValue
      case 'tireCompound': return TIRE_COMPOUND_LABELS[stringValue] ?? stringValue
      case 'aero': return AERO_LABELS[stringValue] ?? stringValue
      default: return stringValue
    }
  }

  if (field.kind === 'number') {
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    if (field.unitCategory && unitFmt) {
      switch (field.unitCategory) {
        case 'pressure': return unitFmt.pressure(n)
        case 'springRate': return unitFmt.springRate(n)
        case 'distanceShortIn': return unitFmt.distanceShort(n * 0.0254) // in → m
        case 'downforce': return unitFmt.downforce(n)
      }
    }
    const rounded = Number.isInteger(n) ? n.toString() : n.toFixed(1)
    return rounded + (field.unit ?? '')
  }

  return String(value)
}

/** Build object shape — derived from BUILD_FIELDS to stay in sync. */
export type BuildSettings = Partial<Record<typeof BUILD_FIELDS[number]['id'], string | number | null>>
