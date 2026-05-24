import type { DropdownMenuItem } from '@nuxt/ui'

// Single source of truth for the global nav. Used by the default-layout
// inline nav row, its mobile-portrait hamburger DropdownMenu, and the
// floating hamburger on /live (since /live hides the whole header on
// phone-sized viewports but still needs an escape hatch to navigate
// elsewhere).
export const NAV_ITEMS: DropdownMenuItem[] = [
  { label: 'Live', to: '/live' },
  { label: 'Hotlap', to: '/hotlap' },
  { label: 'Dyno', to: '/dyno' },
  { label: 'Cars', to: '/cars' },
  { label: 'Events', to: '/events' },
  { label: 'Tune', to: '/tune' },
  { label: 'Upgrade', to: '/upgrade' },
  { label: 'Settings', to: '/settings' }
]
