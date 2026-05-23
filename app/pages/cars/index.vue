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

const { telemetry, hasReceivedFrame } = useTelemetry()

const CLASS_LETTERS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X', 'R']
function carClassLetter(c: number): string {
  return CLASS_LETTERS[c] ?? '?'
}

function lastDrivenLabel(iso: string | null): string {
  return iso ? relativeDate(iso) : 'never driven'
}

// Add the currently-driven car to the garage
const adding = ref(false)
const addError = ref<string | null>(null)

const currentCar = computed(() => {
  const t = telemetry.value
  if (!t || !hasReceivedFrame.value) return null
  return { ordinal: t.car.ordinal, class: t.car.class }
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
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    addError.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'add failed'
  } finally {
    adding.value = false
  }
}

// Delete car (cascades builds → tunes and sessions → laps)
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const deleteTarget = ref<CarRow | null>(null)

function openDelete(car: CarRow) {
  deleteTarget.value = car
  deleteError.value = null
  deleteOpen.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/cars/${target.ordinal}`, { method: 'DELETE' })
    deleteOpen.value = false
    deleteTarget.value = null
    await refreshCars()
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    deleteError.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'delete failed'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader title="Your cars">
      <template #eyebrow>
        Garage
      </template>
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

    <div
      v-if="addError"
      class="mb-6 card-error p-3 font-mono text-xs text-red-300"
    >
      {{ addError }}
    </div>
    <div
      v-if="deleteError"
      class="mb-6 card-error p-3 font-mono text-xs text-red-300"
    >
      {{ deleteError }}
    </div>

    <div
      v-if="cars && cars.length"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div
        v-for="car in cars"
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
        <button
          type="button"
          title="Delete car"
          aria-label="Delete car"
          class="absolute top-3 right-3 rounded-sm border border-transparent p-1.5 text-zinc-600 opacity-0 transition-all hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 focus:opacity-100 focus:outline-none group-hover:opacity-100"
          @click.stop.prevent="openDelete(car)"
        >
          <UIcon
            name="i-lucide-trash-2"
            class="h-4 w-4"
          />
        </button>
      </div>
    </div>
    <div
      v-else
      class="card-dashed p-8 text-center font-mono text-sm text-zinc-500"
    >
      No cars yet. Cars appear here once you record a session in Forza
      with telemetry flowing.
    </div>

    <ConfirmModal
      v-model:open="deleteOpen"
      :title="deleteTarget ? `Delete car “${deleteTarget.displayName ?? `#${deleteTarget.ordinal}`}”?` : 'Delete car?'"
      confirm-label="Delete car"
      :busy="deleting"
      @confirm="confirmDelete"
    >
      <p>
        Permanently remove this car and everything attached to it.
        <span class="text-zinc-300">Cannot be undone.</span>
      </p>
      <ul
        v-if="deleteTarget"
        class="mt-3 space-y-1 text-xs text-zinc-300"
      >
        <li>· {{ deleteTarget.buildCount }} build{{ deleteTarget.buildCount === 1 ? '' : 's' }} (with their tunes)</li>
        <li>· {{ deleteTarget.sessionCount }} session{{ deleteTarget.sessionCount === 1 ? '' : 's' }} (with their laps)</li>
      </ul>
    </ConfirmModal>
  </main>
</template>
