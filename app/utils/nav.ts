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
    to: '/live',
    children: [
      { label: 'Live', to: '/live', exact: true },
      { label: 'Dyno', to: '/dyno', requires: 'tuning' },
      { label: 'Hotlap', to: '/hotlap' }
    ]
  },
  { label: 'Garage', to: '/cars', requires: 'tuning' },
  { label: 'Events', to: '/events', requires: 'tuning' },
  {
    label: 'Reference',
    to: '/tune',
    requires: 'tuning',
    children: [
      { label: 'Tune', to: '/tune', requires: 'tuning' },
      { label: 'Upgrade', to: '/upgrade', requires: 'tuning' },
      { label: 'Manual', to: '/manual', requires: 'tuning' }
    ]
  },
  { label: 'Settings', to: '/settings' }
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
