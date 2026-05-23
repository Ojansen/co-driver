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
  springRate: 'lbin' | 'kgmm'
  downforce: 'lb' | 'kgf'
  power: 'hp' | 'kw' | 'ps'
  torque: 'lbft' | 'nm'
}

export const DEFAULT_UNIT_PREFS: UnitPrefs = {
  speed: 'kmh',
  temperature: 'c',
  pressure: 'psi',
  distance: 'metric',
  springRate: 'lbin',
  downforce: 'lb',
  power: 'kw',
  torque: 'nm'
}

const METRIC_PRESET: UnitPrefs = {
  speed: 'kmh',
  temperature: 'c',
  pressure: 'bar',
  distance: 'metric',
  springRate: 'kgmm',
  downforce: 'kgf',
  power: 'kw',
  torque: 'nm'
}

const IMPERIAL_PRESET: UnitPrefs = {
  speed: 'mph',
  temperature: 'f',
  pressure: 'psi',
  distance: 'imperial',
  springRate: 'lbin',
  downforce: 'lb',
  power: 'hp',
  torque: 'lbft'
}

// Conversion constants — locked here so no library dep is needed.
const KMH_TO_MPH = 0.621371
const PSI_TO_BAR = 0.0689476
const PSI_TO_KPA = 6.89476
const M_TO_FT = 3.28084
const M_TO_MI = 0.000621371
const LBIN_TO_KGMM = 0.0178579
const LB_TO_KGF = 0.453592
const KW_TO_HP = 1.34102
const KW_TO_PS = 1.35962
const NM_TO_LBFT = 0.737562

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
  const prefs = useLocalStorage<UnitPrefs>('forza-data:units', DEFAULT_UNIT_PREFS, {
    mergeDefaults: true
  })

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
    distanceShort: computed(() => prefs.value.distance === 'imperial' ? 'in' : 'mm'),
    springRate: computed(() => prefs.value.springRate === 'kgmm' ? 'kg/mm' : 'lb/in'),
    downforce: computed(() => prefs.value.downforce === 'kgf' ? 'kgf' : 'lb'),
    power: computed(() => {
      if (prefs.value.power === 'hp') return 'hp'
      if (prefs.value.power === 'ps') return 'PS'
      return 'kW'
    }),
    torque: computed(() => prefs.value.torque === 'lbft' ? 'lb-ft' : 'Nm')
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
    /** Short distance with explicit precision (tune-form-friendly). */
    distanceShort(meters: number): string {
      if (prefs.value.distance === 'imperial') {
        return `${(meters * M_TO_FT * 12).toFixed(1)} in`
      }
      return `${(meters * 1000).toFixed(0)} mm`
    },
    springRate(lbPerIn: number): string {
      if (prefs.value.springRate === 'kgmm') return `${(lbPerIn * LBIN_TO_KGMM).toFixed(2)} kg/mm`
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
    torque(nm: number): string {
      if (prefs.value.torque === 'lbft') return `${Math.round(nm * NM_TO_LBFT)} lb-ft`
      return `${Math.round(nm)} Nm`
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
      if (prefs.value.springRate === 'kgmm') return Number((lbPerIn * LBIN_TO_KGMM).toFixed(2))
      return lbPerIn
    },
    /** Stored field is in inches (Forza native ride-height unit). */
    distanceShortIn(inches: number): number {
      if (prefs.value.distance === 'imperial') return inches
      // metric → mm
      return Math.round(inches * 25.4 * 10) / 10
    },
    downforce(lb: number): number {
      if (prefs.value.downforce === 'kgf') return Math.round(lb * LB_TO_KGF)
      return lb
    }
  }

  const fromDisplay = {
    pressure(v: number): number {
      if (prefs.value.pressure === 'bar') return Number((v / PSI_TO_BAR).toFixed(2))
      if (prefs.value.pressure === 'kpa') return Number((v / PSI_TO_KPA).toFixed(2))
      return v
    },
    springRate(v: number): number {
      if (prefs.value.springRate === 'kgmm') return Math.round(v / LBIN_TO_KGMM)
      return v
    },
    distanceShortIn(v: number): number {
      if (prefs.value.distance === 'imperial') return v
      // mm → inches, store at 2dp resolution
      return Number((v / 25.4).toFixed(2))
    },
    downforce(v: number): number {
      if (prefs.value.downforce === 'kgf') return Math.round(v / LB_TO_KGF)
      return v
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
