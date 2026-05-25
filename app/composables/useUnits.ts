/**
 * Unit-of-measurement preferences. Persisted to localStorage so the choice
 * survives reloads. Conversion + formatting helpers live alongside the prefs
 * so consumers can grab a single object instead of importing math.
 *
 * Storage is in Forza's native units (km/h, °C, psi, lb/in, lb, kW, Nm,
 * meters). These helpers convert at display time + when tune-form inputs are
 * round-tripped — nothing on disk changes when the user toggles a unit.
 */

interface UnitPrefs {
  speed: 'kmh' | 'mph'
  temperature: 'c' | 'f'
  pressure: 'psi' | 'bar' | 'kpa'
  /** Picks mm/m/km vs in/ft/mi contextually by magnitude. */
  distance: 'metric' | 'imperial'
  springRate: 'lbin' | 'nmm' | 'kgfmm'
  downforce: 'lb' | 'kgf'
  power: 'hp' | 'kw' | 'ps'
  torque: 'lbft' | 'nm'
  mass: 'kg' | 'lb'
  /** Engine boost. Separate from `pressure` (tires) — different conventions. */
  boost: 'bar' | 'psi' | 'atm'
}

export const DEFAULT_UNIT_PREFS: UnitPrefs = {
  speed: 'kmh',
  temperature: 'c',
  pressure: 'psi',
  distance: 'metric',
  springRate: 'lbin',
  downforce: 'lb',
  power: 'kw',
  torque: 'nm',
  mass: 'kg',
  boost: 'bar'
}

const METRIC_PRESET: UnitPrefs = {
  speed: 'kmh',
  temperature: 'c',
  pressure: 'bar',
  distance: 'metric',
  springRate: 'nmm',
  downforce: 'kgf',
  power: 'kw',
  torque: 'nm',
  mass: 'kg',
  boost: 'bar'
}

const IMPERIAL_PRESET: UnitPrefs = {
  speed: 'mph',
  temperature: 'f',
  pressure: 'psi',
  distance: 'imperial',
  springRate: 'lbin',
  downforce: 'lb',
  power: 'hp',
  torque: 'lbft',
  mass: 'lb',
  boost: 'psi'
}

// Conversion constants — locked here so no library dep is needed.
const KMH_TO_MPH = 0.621371
const PSI_TO_BAR = 0.0689476
const PSI_TO_KPA = 6.89476
const M_TO_FT = 3.28084
const M_TO_MI = 0.000621371
// Spring-rate metric conversions. FH6 lets the player pick between N/mm and
// kgf/mm in its own settings — we mirror both. They differ by g (≈ 9.80665):
// 1 lb/in × 0.175127  = N/mm    (sanity: 240 lb/in = 42 N/mm, FH6 slider min)
// 1 lb/in × 0.0178579 = kgf/mm  (sanity: 240 lb/in = 4.29 kgf/mm)
const LBIN_TO_NMM = 0.175127
const LBIN_TO_KGFMM = 0.0178579
const LB_TO_KGF = 0.453592
const KW_TO_HP = 1.34102
const KW_TO_PS = 1.35962
const HP_TO_PS = 1.01387
const NM_TO_LBFT = 0.737562
const KG_TO_LB = 2.20462
// Forza reports boost in atmospheres relative to ambient.
const ATM_TO_BAR = 1.01325
const ATM_TO_PSI = 14.6959

function cToF(c: number): number {
  return c * 9 / 5 + 32
}

/** Pick 0/1/2 decimals based on magnitude — keeps small values readable
 *  without trailing zeros on big ones. */
function smartDecimals(n: number, base = 1): number {
  const a = Math.abs(n)
  if (a >= 100) return 0
  if (a >= 10) return base
  return base + 1
}

export function useUnits() {
  const prefs = useLocalStorage<UnitPrefs>('co-driver:units', DEFAULT_UNIT_PREFS, {
    mergeDefaults: true
  })

  // Legacy migration: the old metric spring-rate value 'kgmm' was mislabeled —
  // it stored kgf/mm-magnitude numbers, but FH6's slider is in N/mm (= kgf/mm × g).
  // Anything still set to 'kgmm' in localStorage gets bumped to the corrected
  // 'nmm' so the UI shows the right unit and conversion.
  if ((prefs.value.springRate as string) === 'kgmm') {
    prefs.value = { ...prefs.value, springRate: 'nmm' }
  }

  // --- unit labels --------------------------------------------------------

  const unitLabel = reactive({
    speed: computed(() => prefs.value.speed === 'mph' ? 'mph' : 'km/h'),
    temperature: computed(() => prefs.value.temperature === 'f' ? '°F' : '°C'),
    pressure: computed(() => {
      if (prefs.value.pressure === 'bar') return 'bar'
      if (prefs.value.pressure === 'kpa') return 'kPa'
      return 'psi'
    }),
    /** Bare suffix for tune-form inputs (short distance — ride height etc.) */
    distanceShort: computed(() => prefs.value.distance === 'imperial' ? 'in' : 'cm'),
    springRate: computed(() => {
      if (prefs.value.springRate === 'nmm') return 'N/mm'
      if (prefs.value.springRate === 'kgfmm') return 'kgf/mm'
      return 'lb/in'
    }),
    // ride height: cm in metric (FH6 displays cm), in/ in imperial.
    downforce: computed(() => prefs.value.downforce === 'kgf' ? 'kgf' : 'lb'),
    power: computed(() => {
      if (prefs.value.power === 'hp') return 'hp'
      if (prefs.value.power === 'ps') return 'PS'
      return 'kW'
    }),
    torque: computed(() => prefs.value.torque === 'lbft' ? 'lb-ft' : 'Nm'),
    mass: computed(() => prefs.value.mass === 'lb' ? 'lb' : 'kg'),
    boost: computed(() => {
      if (prefs.value.boost === 'psi') return 'psi'
      if (prefs.value.boost === 'atm') return 'atm'
      return 'bar'
    })
  })

  // --- display formatters (string with suffix) ---------------------------

  const format = {
    speed(kmh: number): string {
      if (prefs.value.speed === 'mph') return `${Math.round(kmh * KMH_TO_MPH)} mph`
      return `${Math.round(kmh)} km/h`
    },
    temp(c: number): string {
      const v = prefs.value.temperature === 'f' ? cToF(c) : c
      return `${v.toFixed(1)} ${unitLabel.temperature}`
    },
    pressure(psi: number): string {
      if (prefs.value.pressure === 'bar') return `${(psi * PSI_TO_BAR).toFixed(2)} bar`
      if (prefs.value.pressure === 'kpa') return `${Math.round(psi * PSI_TO_KPA)} kPa`
      return `${psi.toFixed(1)} psi`
    },
    /** Auto-scaled distance. `meters` is the canonical input. */
    distance(meters: number): string {
      const imperial = prefs.value.distance === 'imperial'
      if (imperial) {
        const ft = meters * M_TO_FT
        if (Math.abs(meters) >= 1609) {
          const mi = meters * M_TO_MI
          return `${mi.toFixed(mi >= 10 ? 1 : 2)} mi`
        }
        if (Math.abs(meters) < 0.5) {
          const inches = ft * 12
          return `${inches.toFixed(smartDecimals(inches))} in`
        }
        return `${ft.toFixed(smartDecimals(ft, 0))} ft`
      }
      if (Math.abs(meters) >= 1000) {
        const km = meters / 1000
        return `${km.toFixed(km % 1 === 0 ? 0 : km >= 10 ? 1 : 2)} km`
      }
      if (Math.abs(meters) < 0.5) {
        return `${Math.round(meters * 1000)} mm`
      }
      return `${meters.toFixed(smartDecimals(meters, 0))} m`
    },
    /** Short distance with explicit precision (tune-form-friendly). FH6
     *  shows ride height in cm with 0.1 cm steps; we keep 2 decimals so
     *  imperial-canonical values (multiples of 0.0254 cm) round-trip
     *  without losing precision. */
    distanceShort(meters: number): string {
      if (prefs.value.distance === 'imperial') {
        return `${(meters * M_TO_FT * 12).toFixed(2)} in`
      }
      return `${(meters * 100).toFixed(2)} cm`
    },
    springRate(lbPerIn: number): string {
      if (prefs.value.springRate === 'nmm') return `${(lbPerIn * LBIN_TO_NMM).toFixed(2)} N/mm`
      if (prefs.value.springRate === 'kgfmm') return `${(lbPerIn * LBIN_TO_KGFMM).toFixed(2)} kgf/mm`
      return `${Math.round(lbPerIn)} lb/in`
    },
    downforce(lb: number): string {
      if (prefs.value.downforce === 'kgf') return `${Math.round(lb * LB_TO_KGF)} kgf`
      return `${Math.round(lb)} lb`
    },
    power(kw: number): string {
      if (prefs.value.power === 'hp') return `${Math.round(kw * KW_TO_HP)} hp`
      if (prefs.value.power === 'ps') return `${Math.round(kw * KW_TO_PS)} PS`
      return `${Math.round(kw)} kW`
    },
    /** Same as `power` but the input is in HP (canonical for build form). */
    powerHp(hp: number): string {
      if (prefs.value.power === 'kw') return `${Math.round(hp / KW_TO_HP)} kW`
      if (prefs.value.power === 'ps') return `${Math.round(hp * HP_TO_PS)} PS`
      return `${Math.round(hp)} hp`
    },
    torque(nm: number): string {
      if (prefs.value.torque === 'lbft') return `${Math.round(nm * NM_TO_LBFT)} lb-ft`
      return `${Math.round(nm)} Nm`
    },
    mass(kg: number): string {
      if (prefs.value.mass === 'lb') return `${Math.round(kg * KG_TO_LB)} lb`
      return `${Math.round(kg)} kg`
    },
    /** Engine boost. Input is atmospheres relative to ambient (Forza native). */
    boost(atm: number): string {
      if (prefs.value.boost === 'psi') return `${(atm * ATM_TO_PSI).toFixed(1)} psi`
      if (prefs.value.boost === 'atm') return `${atm.toFixed(2)} atm`
      return `${(atm * ATM_TO_BAR).toFixed(2)} bar`
    }
  }

  // --- bare-number converters for form inputs (no suffix) ----------------
  // `toDisplay.x(stored)` → number shown in the input.
  // `fromDisplay.x(displayed)` → number to save back to storage.

  const toDisplay = {
    pressure(psi: number): number {
      if (prefs.value.pressure === 'bar') return Number((psi * PSI_TO_BAR).toFixed(2))
      if (prefs.value.pressure === 'kpa') return Math.round(psi * PSI_TO_KPA)
      return psi
    },
    springRate(lbPerIn: number): number {
      if (prefs.value.springRate === 'nmm') return Number((lbPerIn * LBIN_TO_NMM).toFixed(2))
      if (prefs.value.springRate === 'kgfmm') return Number((lbPerIn * LBIN_TO_KGFMM).toFixed(2))
      return lbPerIn
    },
    /** Stored field is in inches (Forza native ride-height unit). Metric
     *  display is cm (FH6 convention) with 2-decimal precision. */
    distanceShortIn(inches: number): number {
      if (prefs.value.distance === 'imperial') return Number(inches.toFixed(2))
      // inches → cm (2.54 cm per inch)
      return Number((inches * 2.54).toFixed(2))
    },
    downforce(lb: number): number {
      if (prefs.value.downforce === 'kgf') return Math.round(lb * LB_TO_KGF)
      return lb
    },
    /** Build form canonical = HP. Returns the input value in the display unit. */
    powerHp(hp: number): number {
      if (prefs.value.power === 'kw') return Math.round(hp / KW_TO_HP)
      if (prefs.value.power === 'ps') return Math.round(hp * HP_TO_PS)
      return Math.round(hp)
    },
    /** Build form canonical = kg. */
    mass(kg: number): number {
      if (prefs.value.mass === 'lb') return Math.round(kg * KG_TO_LB)
      return Math.round(kg)
    }
  }

  const fromDisplay = {
    pressure(v: number): number {
      if (prefs.value.pressure === 'bar') return Number((v / PSI_TO_BAR).toFixed(2))
      if (prefs.value.pressure === 'kpa') return Number((v / PSI_TO_KPA).toFixed(2))
      return v
    },
    springRate(v: number): number {
      if (prefs.value.springRate === 'nmm') return Math.round(v / LBIN_TO_NMM)
      if (prefs.value.springRate === 'kgfmm') return Math.round(v / LBIN_TO_KGFMM)
      return v
    },
    distanceShortIn(v: number): number {
      if (prefs.value.distance === 'imperial') return v
      // cm → inches (store at 2dp resolution)
      return Number((v / 2.54).toFixed(2))
    },
    downforce(v: number): number {
      if (prefs.value.downforce === 'kgf') return Math.round(v / LB_TO_KGF)
      return v
    },
    powerHp(v: number): number {
      if (prefs.value.power === 'kw') return Math.round(v * KW_TO_HP)
      if (prefs.value.power === 'ps') return Math.round(v / HP_TO_PS)
      return Math.round(v)
    },
    mass(v: number): number {
      if (prefs.value.mass === 'lb') return Math.round(v / KG_TO_LB)
      return Math.round(v)
    }
  }

  function applyPreset(preset: 'metric' | 'imperial'): void {
    prefs.value = { ...(preset === 'metric' ? METRIC_PRESET : IMPERIAL_PRESET) }
  }

  return { prefs, unitLabel, format, toDisplay, fromDisplay, applyPreset }
}

export type UnitFormat = ReturnType<typeof useUnits>['format']
export type UnitLabel = ReturnType<typeof useUnits>['unitLabel']
export type { UnitPrefs }
