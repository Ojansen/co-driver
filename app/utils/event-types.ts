// Mirror of server/db/schema.ts eventType — duplicated to keep the app bundle free
// of drizzle/sqlite imports. Keep these in sync.

export const eventType = ['rally', 'race', 'street_race', 'cross_country', 'drag', 'freeroam'] as const
export type EventType = typeof eventType[number]

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  rally: 'Rally',
  race: 'Race',
  street_race: 'Street Race',
  cross_country: 'Cross Country',
  drag: 'Drag',
  freeroam: 'Free Roam'
}

export const EVENT_TYPE_ORDER: readonly EventType[] = [
  'race',
  'street_race',
  'rally',
  'cross_country',
  'drag',
  'freeroam'
]

export function isEventType(s: string): s is EventType {
  return (eventType as readonly string[]).includes(s)
}
