import type { DropdownMenuItem } from '@nuxt/ui'

// Single source of truth for the global nav. Used by the default-layout's
// horizontal nav row (desktop) AND its mobile-portrait hamburger
// DropdownMenu, plus the floating hamburger on `/live` (which hides the
// whole header on phone-sized viewports but still needs an escape hatch).
//
// `exact: true` means the active highlight only lights up on an exact
// path match — used for routes like `/live` that have no children we
// want to keep highlighted under. Default is `active-class` behavior
// (highlight stays lit for `/tune/dampers` etc).
//
// Extends `DropdownMenuItem` so the dropdown component still accepts the
// list unchanged; the extra `exact` field is ignored there.

export interface NavItem extends DropdownMenuItem {
  to: string
  label: string
  exact?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Live', to: '/live', exact: true },
  { label: 'Hotlap', to: '/hotlap' },
  { label: 'Dyno', to: '/dyno' },
  { label: 'Garage', to: '/cars' },
  { label: 'Events', to: '/events' },
  { label: 'Tune', to: '/tune' },
  { label: 'Upgrade', to: '/upgrade' },
  { label: 'Manual', to: '/manual' },
  { label: 'Settings', to: '/settings' }
]
