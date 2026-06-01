<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const ordinalParam = Number(route.params.ordinal)
if (!Number.isInteger(ordinalParam) || ordinalParam < 0) {
  throw createError({ statusCode: 404, statusMessage: 'invalid car ordinal' })
}
const ordinal = ordinalParam

interface CarRow {
  ordinal: number
  class: number
  displayName: string | null
}
interface BuildRow {
  id: number
  name: string
  createdAt: string
  tuneCount: number
  sessionCount: number
  lastUsedAt: string | null
}

const { data: cars, refresh: refreshCars } = await useFetch<CarRow[]>('/api/cars', { default: () => [] })
const car = computed(() => cars.value?.find(c => c.ordinal === ordinal) ?? null)

const { data: builds, refresh: refreshBuilds } = await useFetch<BuildRow[]>(
  `/api/cars/${ordinal}/builds`,
  { default: () => [] }
)

useHead({ title: () => `${car.value?.displayName ?? `#${ordinal}`} · garage` })

async function saveName(next: string | null) {
  await $fetch(`/api/cars/${ordinal}`, { method: 'PATCH', body: { displayName: next } })
  await refreshCars()
}

async function createBuild(name: string) {
  const created = await $fetch<{ id: number }>(`/api/cars/${ordinal}/builds`, {
    method: 'POST',
    body: { name, settings: {} }
  })
  await refreshBuilds()
  await router.push(`/cars/${ordinal}/builds/${created.id}`)
}

const CLASS_LETTERS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X', 'R']
function carClassLetter(c: number): string {
  return CLASS_LETTERS[c] ?? '?'
}
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <NuxtLink
        to="/cars"
        class="hover:text-zinc-300"
      >
        Garage
      </NuxtLink>
      <span class="mx-2 text-zinc-700">/</span>
      <span class="text-zinc-300">{{ car?.displayName ?? `#${ordinal}` }}</span>
    </div>

    <InlineEdit
      class="mb-8"
      :value="car?.displayName ?? null"
      :placeholder="`#${ordinal}`"
      :save="saveName"
      :input-ui="{ base: 'text-2xl' }"
    >
      <template #display="{ edit }">
        <div class="flex items-baseline gap-3">
          <h1 class="font-mono text-3xl text-zinc-100">
            {{ car?.displayName ?? `#${ordinal}` }}
          </h1>
          <span
            v-if="car"
            class="font-mono text-sm text-zinc-500"
          >[{{ carClassLetter(car.class) }}]</span>
          <UButton
            label="rename"
            color="neutral"
            variant="link"
            size="xs"
            class="ml-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600 hover:text-zinc-300"
            @click="edit"
          />
        </div>
      </template>
    </InlineEdit>

    <CreateForm
      class="mb-8"
      title="New build"
      placeholder="e.g. S2 race trim"
      :submit="createBuild"
    />

    <ul
      v-if="builds && builds.length"
      class="space-y-2"
    >
      <li
        v-for="build in builds"
        :key="build.id"
        class="group flex items-stretch gap-2"
      >
        <NuxtLink
          :to="`/cars/${ordinal}/builds/${build.id}`"
          class="flex flex-1 items-center justify-between card p-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900/60"
        >
          <div class="font-mono">
            <div class="text-zinc-100">
              {{ build.name }}
            </div>
            <div class="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {{ build.tuneCount }} tune{{ build.tuneCount === 1 ? '' : 's' }} · {{ build.sessionCount }} session{{ build.sessionCount === 1 ? '' : 's' }}
            </div>
          </div>
          <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 group-hover:text-zinc-300">
            →
          </span>
        </NuxtLink>
        <DeleteAction
          :url="`/api/builds/${build.id}`"
          :title="`Delete build “${build.name}”?`"
          confirm-label="Delete build"
          label="Delete"
          trigger-class="shrink-0"
          @deleted="refreshBuilds()"
        >
          <p>
            Permanently remove this build and its tunes.
            <span class="text-zinc-300">Cannot be undone.</span>
          </p>
          <ul class="mt-3 space-y-1 text-xs text-zinc-300">
            <li v-if="build.tuneCount > 0">
              · {{ build.tuneCount }} tune{{ build.tuneCount === 1 ? '' : 's' }} will be deleted with it.
            </li>
            <li v-if="build.sessionCount > 0">
              · {{ build.sessionCount }} session{{ build.sessionCount === 1 ? '' : 's' }} will be unlinked
              <span class="text-zinc-500">(their build snapshot stays — laps + compare still work)</span>
            </li>
            <li v-if="build.tuneCount === 0 && build.sessionCount === 0">
              · No tunes or sessions reference this build.
            </li>
          </ul>
        </DeleteAction>
      </li>
    </ul>
    <UEmpty
      v-else
      icon="i-lucide-wrench"
      title="No builds yet"
      description="Create one above."
      class="card-dashed font-mono"
    />
  </main>
</template>
