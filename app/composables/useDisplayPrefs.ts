/**
 * Dashboard display preferences — kept separate from useUnits so the
 * metric/imperial unit presets can't clobber the chosen cluster style.
 * Persisted to localStorage so the choice survives reloads.
 */

export type ClusterStyle = 'twin' | 'digital'

interface DisplayPrefs {
  /** Instrument-cluster style for the live dashboard center panel. */
  cluster: ClusterStyle
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  cluster: 'twin'
}

export function useDisplayPrefs() {
  const prefs = useLocalStorage<DisplayPrefs>('co-driver:dashboard', DEFAULT_DISPLAY_PREFS, {
    mergeDefaults: true
  })
  return { prefs }
}

export type { DisplayPrefs }
