import type { NavigationMenuItem } from '@nuxt/ui'
import type { GameCapabilities } from '#shared/games'

// Single source of truth for the global nav. Consumed by:
//   - the default layout's horizontal UNavigationMenu (desktop, sm+)
//   - AppMobileNav's vertical UNavigationMenu (the mobile slide-in drawer)
//   - the floating hamburgers on /live and /hotlap (same drawer, those pages
//     hide the site header on phone-sized viewports)
//
// Two routes are grouped under parent items that render as dropdowns on
// desktop and collapsible sections in the mobile drawer:
//   - "Telemetry" → the live-feed dashboards (Live / Dyno / Hotlap). The
//     parent links to /live so the hot path stays one click away; hovering
//     reveals the siblings.
//   - "Reference" → the tuning knowledge pages (Tune / Upgrade / Manual).
// Garage, Events and Settings stay top-level — they don't fit either bucket.
//
// `exact: true` means the active highlight only lights up on an exact path
// match — used for /live, which has no children we want to keep highlighted
// under. Default behavior keeps the parent lit for nested paths (e.g.
// /tune/dampers lights "Tune").

export interface NavItem extends NavigationMenuItem {
  label: string
  to?: string
  exact?: boolean
  // Game capability this route needs. Omitted = always shown (telemetry-only
  // routes that work for any game with a wired decoder). Items requiring a
  // capability are hidden when the active game lacks it — see navForGame().
  // On a parent, it gates the whole group; a group is also dropped when all
  // of its children get filtered out.
  requires?: keyof GameCapabilities
  children?: NavItem[]
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Telemetry',
    icon: 'i-lucide-activity',
    to: '/live',
    children: [
      { label: 'Live', to: '/live', exact: true, icon: 'i-lucide-radio' },
      { label: 'Dyno', to: '/dyno', requires: 'tuning', icon: 'i-lucide-gauge' },
      { label: 'Hotlap', to: '/hotlap', icon: 'i-lucide-timer' }
    ]
  },
  { label: 'Garage', to: '/cars', requires: 'tuning', icon: 'i-lucide-car' },
  // Events = the recordings browser (sessions → laps → replay/compare). Universal:
  // any game with a decoder can record and review.
  { label: 'Events', to: '/events', icon: 'i-lucide-flag' },
  {
    label: 'Reference',
    icon: 'i-lucide-book-open',
    to: '/manual',
    // Parent is universal so the Manual child always shows; Tune/Upgrade stay
    // FH6-gated and drop out for other games (navForGame filters children).
    children: [
      { label: 'Tune', to: '/tune', requires: 'tuning', icon: 'i-lucide-sliders-horizontal' },
      { label: 'Upgrade', to: '/upgrade', requires: 'tuning', icon: 'i-lucide-arrow-up-circle' },
      { label: 'Manual', to: '/manual', icon: 'i-lucide-book-open-text' }
    ]
  },
  {
    label: 'System',
    icon: 'i-lucide-settings',
    to: '/settings',
    children: [
      { label: 'Settings', to: '/settings', exact: true, icon: 'i-lucide-settings' },
      { label: 'Transfer', to: '/transfer', icon: 'i-lucide-arrow-left-right' }
    ]
  }
]

/** Nav items visible for a game's capability set: an item shows when it
 *  requires no capability, or the game has the one it requires. Parents with
 *  children keep only their visible children, and drop out entirely when none
 *  remain. */
export function navForGame(capabilities: GameCapabilities): NavItem[] {
  const allowed = (item: NavItem) => !item.requires || capabilities[item.requires]
  return NAV_ITEMS.flatMap((item) => {
    if (item.children) {
      const children = item.children.filter(allowed)
      return children.length ? [{ ...item, children }] : []
    }
    return allowed(item) ? [item] : []
  })
}
