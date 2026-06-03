<script setup lang="ts">
useHead({ title: 'Garage · co-driver' })

interface CarRow {
  ordinal: number
  class: number
  displayName: string | null
  buildCount: number
  sessionCount: number
  lastUsedAt: string | null
}

const { data: cars, refresh: refreshCars } = await useFetch<CarRow[]>('/api/cars', { default: () => [] })

const { lastLiveCar, hasReceivedFrame, connected } = useTelemetry()

const CLASS_LETTERS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X', 'R']
function carClassLetter(c: number): string {
  return CLASS_LETTERS[c] ?? '?'
}

function lastDrivenLabel(iso: string | null): string {
  return iso ? relativeDate(iso) : 'never driven'
}

// --- Filtering / sorting / grouping ----------------------------------------
const search = ref('')
const activeClasses = ref<Set<number>>(new Set())
const grouped = ref(false)

type SortKey = 'last-used' | 'sessions' | 'builds' | 'class' | 'name'
const sortBy = ref<SortKey>('last-used')
const sortItems = [
  { label: 'Last used', value: 'last-used' },
  { label: 'Most sessions', value: 'sessions' },
  { label: 'Most builds', value: 'builds' },
  { label: 'Class', value: 'class' },
  { label: 'Name', value: 'name' }
]

// Only offer class chips for classes that actually exist in the garage.
const availableClasses = computed(() => {
  const present = new Set((cars.value ?? []).map(c => c.class))
  return [...present].sort((a, b) => a - b)
})

function toggleClass(c: number) {
  const next = new Set(activeClasses.value)
  if (next.has(c)) next.delete(c)
  else next.add(c)
  activeClasses.value = next
}

function carName(car: CarRow): string {
  return car.displayName ?? `#${car.ordinal}`
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const classes = activeClasses.value
  return (cars.value ?? []).filter((car) => {
    if (classes.size && !classes.has(car.class)) return false
    if (!q) return true
    return carName(car).toLowerCase().includes(q)
      || carClassLetter(car.class).toLowerCase() === q
      || String(car.ordinal).includes(q)
  })
})

const sorted = computed(() => {
  const rows = [...filtered.value]
  switch (sortBy.value) {
    case 'sessions':
      return rows.sort((a, b) => b.sessionCount - a.sessionCount)
    case 'builds':
      return rows.sort((a, b) => b.buildCount - a.buildCount)
    case 'class':
      return rows.sort((a, b) => a.class - b.class || carName(a).localeCompare(carName(b)))
    case 'name':
      return rows.sort((a, b) => carName(a).localeCompare(carName(b)))
    case 'last-used':
    default:
      // Most recently driven first; never-driven (null) sinks to the bottom.
      return rows.sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
  }
})

// One render path for both layouts: flat mode is a single unlabelled group.
const displayGroups = computed(() => {
  if (!grouped.value) {
    return [{ key: 'all', label: null as string | null, cars: sorted.value }]
  }
  const byClass = new Map<number, CarRow[]>()
  for (const car of sorted.value) {
    const arr = byClass.get(car.class)
    if (arr) arr.push(car)
    else byClass.set(car.class, [car])
  }
  return [...byClass.keys()]
    .sort((a, b) => a - b)
    .map(c => ({ key: `class-${c}`, label: carClassLetter(c), cars: byClass.get(c)! }))
})

// Add the currently-driven car to the garage
const adding = ref(false)
const addError = ref<string | null>(null)

// Read from lastLiveCar (sticky across pause) rather than the latest frame:
// Forza zeros car.ordinal on the pause menu, which would let the user "add"
// a phantom ordinal-0 car. lastLiveCar carries the most recent populated
// identity, so the button keeps showing the actual car you're in.
const currentCar = computed(() => {
  const c = lastLiveCar.value
  if (!c) return null
  return { ordinal: c.ordinal, class: c.class }
})

const currentCarInGarage = computed(() => {
  const cur = currentCar.value
  if (!cur || !cars.value) return false
  return cars.value.some(c => c.ordinal === cur.ordinal)
})

async function addCurrentCar() {
  const cur = currentCar.value
  if (!cur || adding.value) return
  adding.value = true
  addError.value = null
  try {
    await $fetch('/api/cars', { method: 'POST', body: cur })
    await refreshCars()
  } catch (err) {
    addError.value = apiErrorMessage(err, 'add failed')
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader title="Garage">
      <template #actions>
        <UButton
          :disabled="!currentCar || currentCarInGarage || adding"
          :loading="adding"
          icon="i-lucide-plus"
          color="primary"
          variant="outline"
          :title="!currentCar
            ? 'Waiting for telemetry — start Forza first'
            : currentCarInGarage
              ? 'Current car is already in your garage'
              : `Add ordinal ${currentCar.ordinal} to garage`"
          @click="addCurrentCar"
        >
          {{ currentCarInGarage ? 'Current car added' : 'Add current car' }}
        </UButton>
      </template>
    </PageHeader>

    <UAlert
      v-if="addError"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :description="addError"
      class="mb-6"
      :ui="{ description: 'font-mono text-xs' }"
    />

    <template v-if="cars && cars.length">
      <!-- Filter / sort / group controls -->
      <div class="mb-6 flex flex-wrap items-center gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search name or ordinal…"
          class="w-full sm:w-64"
        />
        <div
          v-if="availableClasses.length > 1"
          class="flex flex-wrap items-center gap-1.5"
        >
          <UButton
            v-for="c in availableClasses"
            :key="c"
            :variant="activeClasses.has(c) ? 'solid' : 'outline'"
            :color="activeClasses.has(c) ? 'primary' : 'neutral'"
            size="xs"
            class="font-mono text-[11px] tracking-[0.15em]"
            @click="toggleClass(c)"
          >
            {{ carClassLetter(c) }}
          </UButton>
        </div>
        <div class="flex items-center gap-2 sm:ml-auto">
          <USelect
            v-model="sortBy"
            :items="sortItems"
            size="sm"
            class="w-40 text-sm"
          />
          <UButton
            :variant="grouped ? 'solid' : 'outline'"
            :color="grouped ? 'primary' : 'neutral'"
            size="sm"
            icon="i-lucide-layers"
            :title="grouped ? 'Showing class groups' : 'Group by class'"
            @click="grouped = !grouped"
          >
            Group by class
          </UButton>
        </div>
      </div>

      <div
        v-if="!sorted.length"
        class="card p-8 text-center text-sm text-zinc-400"
      >
        No cars match these filters.
      </div>

      <div
        v-for="group in displayGroups"
        :key="group.key"
        :class="group.label ? 'mb-8' : ''"
      >
        <div
          v-if="group.label"
          class="mb-3 flex items-baseline gap-2 font-mono text-xs uppercase tracking-[0.3em] text-zinc-500"
        >
          <span class="text-zinc-300">{{ group.label }}</span>
          <span class="text-zinc-600">· {{ group.cars.length }} car{{ group.cars.length === 1 ? '' : 's' }}</span>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="car in group.cars"
            :key="car.ordinal"
            class="group relative card p-5 transition-colors hover:border-zinc-600 hover:bg-zinc-900/60"
          >
            <NuxtLink
              :to="`/cars/${car.ordinal}`"
              class="flex flex-col gap-2"
            >
              <div class="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 group-hover:text-zinc-400">
                [{{ carClassLetter(car.class) }}] · ordinal {{ car.ordinal }}
              </div>
              <div class="font-mono text-xl text-zinc-100 pr-8">
                {{ car.displayName ?? `#${car.ordinal}` }}
              </div>
              <div class="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px] text-zinc-400">
                <div>
                  <div class="text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                    Builds
                  </div>
                  <div class="text-zinc-200">
                    {{ car.buildCount }}
                  </div>
                </div>
                <div>
                  <div class="text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                    Sessions
                  </div>
                  <div class="text-zinc-200">
                    {{ car.sessionCount }}
                  </div>
                </div>
                <div>
                  <div class="text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                    Last used
                  </div>
                  <div class="text-zinc-200">
                    {{ lastDrivenLabel(car.lastUsedAt) }}
                  </div>
                </div>
              </div>
            </NuxtLink>
            <DeleteAction
              :url="`/api/cars/${car.ordinal}`"
              :title="`Delete car “${car.displayName ?? `#${car.ordinal}`}”?`"
              confirm-label="Delete car"
              icon="i-lucide-trash-2"
              color="neutral"
              size="xs"
              trigger-title="Delete car"
              trigger-aria-label="Delete car"
              trigger-class="absolute top-3 right-3 text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
              @deleted="refreshCars()"
            >
              <p>
                Permanently remove this car and everything attached to it.
                <span class="text-zinc-300">Cannot be undone.</span>
              </p>
              <ul class="mt-3 space-y-1 text-xs text-zinc-300">
                <li>· {{ car.buildCount }} build{{ car.buildCount === 1 ? '' : 's' }} (with their tunes)</li>
                <li>· {{ car.sessionCount }} session{{ car.sessionCount === 1 ? '' : 's' }} (with their laps)</li>
              </ul>
            </DeleteAction>
          </div>
        </div>
      </div>
    </template>
    <TelemetryWaiting
      v-else-if="!hasReceivedFrame"
      :connected="connected"
      title="No cars yet"
    >
      Cars appear here once telemetry is flowing — start a race in Forza with
      Data Out enabled and your current car shows up to add to the garage.
    </TelemetryWaiting>
    <TelemetryWaiting
      v-else
      title="Garage is empty"
    >
      You're connected and driving. Hit
      <span class="text-zinc-200">Add current car</span> above to start
      tracking it, or record a session and it'll land here automatically.
    </TelemetryWaiting>
  </main>
</template>
