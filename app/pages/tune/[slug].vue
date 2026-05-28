<script setup lang="ts">
import {
  findCategory,
  SIGNAL_LABEL,
  SIGNAL_WHERE,
  TUNE_CATEGORIES,
  DIAGNOSES
} from '~/utils/tuning-reference'

const route = useRoute()
const slug = String(route.params.slug ?? '')
const cat = findCategory(slug)

if (!cat) {
  throw createError({ statusCode: 404, statusMessage: 'unknown tuning category' })
}

useHead({ title: `${cat.title} · tuning reference` })

// Slugs that surface a telemetry graph above the static copy. All ride the
// same useTuneData() data path as YourDataPanel below (same N-lap window, same
// car/build resolution). Components handle the null case internally.
const GRAPH_SLUGS = new Set([
  'dampers', 'ride-height', 'gearing', 'tire-pressure', 'alignment',
  'anti-roll-bars', 'differential'
])
const tuneData = GRAPH_SLUGS.has(slug) ? useTuneData() : null

const lapsLabel = computed(() => {
  const n = tuneData?.data.value?.lapCount ?? 0
  return `last ${n} lap${n === 1 ? '' : 's'}`
})

const relatedCats = computed(() =>
  (cat!.related ?? [])
    .map(s => TUNE_CATEGORIES.find(c => c.slug === s))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
)

const relevantDiagnoses = computed(() =>
  DIAGNOSES.filter(d => d.investigate.some(s => s.slug === cat!.slug))
)
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader :title="cat.title">
      <template #eyebrow>
        <NuxtLink
          to="/tune"
          class="hover:text-zinc-300"
        >
          Tuning reference
        </NuxtLink>
        <span class="text-zinc-700">/</span>
        <span class="text-zinc-300">{{ cat.slug }}</span>
      </template>
      <template #icon>
        <UIcon
          :name="`i-lucide-${cat.icon}`"
          class="h-6 w-6 text-zinc-400"
        />
      </template>
      <template #intro>
        {{ cat.summary }}
      </template>
    </PageHeader>

    <YourDataPanel :slug="slug" />

    <section
      v-if="slug === 'dampers' && tuneData?.data.value?.damperHistograms"
      class="mb-10"
    >
      <SuspensionHistogram
        :histograms="tuneData.data.value.damperHistograms"
        title="damper velocity"
        :subtitle="`last ${tuneData.data.value.lapCount} lap${tuneData.data.value.lapCount === 1 ? '' : 's'}`"
      />
    </section>

    <section
      v-if="slug === 'dampers' && tuneData?.data.value?.damperScatter"
      class="mb-10"
    >
      <DamperScatter
        :scatter="tuneData.data.value.damperScatter"
        title="damper position × velocity"
        :subtitle="`last ${tuneData.data.value.lapCount} lap${tuneData.data.value.lapCount === 1 ? '' : 's'}`"
      />
    </section>

    <section
      v-if="slug === 'ride-height' && tuneData?.data.value?.rideHeightHistograms"
      class="mb-10"
    >
      <RideHeightHistogram
        :histograms="tuneData.data.value.rideHeightHistograms"
        title="ride height"
        :subtitle="`last ${tuneData.data.value.lapCount} lap${tuneData.data.value.lapCount === 1 ? '' : 's'}`"
      />
    </section>

    <section
      v-if="slug === 'gearing' && tuneData?.data.value?.dynoCurve && tuneData.data.value.dynoCurve.buckets.length"
      class="mb-6"
    >
      <DynoCurve
        :curve="tuneData.data.value.dynoCurve"
        mode="detailed"
        title="dyno"
        :subtitle="lapsLabel"
      />
    </section>

    <section
      v-if="slug === 'gearing' && tuneData?.data.value?.rpmHistogram"
      class="mb-10"
    >
      <ChannelHistogram
        :histogram="tuneData.data.value.rpmHistogram"
        title="time at rpm"
        :subtitle="lapsLabel"
        unit="rpm"
      />
    </section>

    <section
      v-if="(slug === 'tire-pressure' || slug === 'alignment') && tuneData?.data.value?.tireTemp"
      class="mb-10"
    >
      <QuadHistogram
        :histograms="tuneData.data.value.tireTemp"
        title="tire temperature"
        :subtitle="lapsLabel"
        unit="°C"
      />
    </section>

    <section
      v-if="slug === 'anti-roll-bars' && tuneData?.data.value?.slipAngleBalance"
      class="mb-10"
    >
      <ChannelHistogram
        :histogram="tuneData.data.value.slipAngleBalance"
        title="balance · front − rear slip angle"
        :subtitle="`${lapsLabel} · cornering only`"
        unit="°"
        :signed="true"
        left-label="oversteer"
        right-label="understeer"
      />
    </section>

    <section
      v-if="slug === 'differential' && tuneData?.data.value?.slipRatio"
      class="mb-10"
    >
      <QuadHistogram
        :histograms="tuneData.data.value.slipRatio"
        title="wheel slip ratio"
        :subtitle="lapsLabel"
        :signed="true"
        :decimals="1"
      />
    </section>

    <section class="mb-10">
      <h2 class="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-zinc-400">
        What it does
      </h2>
      <div class="space-y-3 text-sm leading-relaxed text-zinc-300">
        <p
          v-for="(para, i) in cat.what"
          :key="i"
        >
          {{ para }}
        </p>
      </div>
    </section>

    <section class="mb-10">
      <h2 class="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-zinc-400">
        In-game controls
      </h2>
      <div class="space-y-3">
        <div
          v-for="ctrl in cat.controls"
          :key="ctrl.name"
          class="card p-4"
        >
          <div class="mb-1 font-mono text-sm text-zinc-100">
            {{ ctrl.name }}
          </div>
          <div class="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Range: {{ ctrl.range }}
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div class="card-warn p-2.5 text-sm">
              <div class="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400/70">
                Raise →
              </div>
              <div class="text-zinc-300">
                {{ ctrl.raises }}
              </div>
            </div>
            <div class="card-info p-2.5 text-sm">
              <div class="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400/70">
                ← Lower
              </div>
              <div class="text-zinc-300">
                {{ ctrl.lowers }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="mb-10">
      <h2 class="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-zinc-400">
        Watch these telemetry signals
      </h2>
      <ul class="space-y-2">
        <li
          v-for="sig in cat.signals"
          :key="sig.key"
          class="card p-3"
        >
          <div class="mb-0.5 flex items-baseline justify-between gap-2">
            <span class="font-mono text-sm text-zinc-100">{{ SIGNAL_LABEL[sig.key] }}</span>
            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">{{ sig.key }}</span>
          </div>
          <div class="text-xs text-zinc-500">
            Where: {{ SIGNAL_WHERE[sig.key] }}
          </div>
          <div class="mt-1.5 text-sm text-zinc-300">
            {{ sig.look }}
          </div>
        </li>
      </ul>
    </section>

    <section class="mb-10">
      <h2 class="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-zinc-400">
        Symptom → fix
      </h2>
      <div class="overflow-hidden rounded-md border border-zinc-800">
        <table class="w-full font-mono text-sm">
          <thead class="bg-zinc-900/60">
            <tr class="text-left text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              <th class="px-3 py-2 font-normal">
                What you feel
              </th>
              <th class="px-3 py-2 font-normal">
                Likely cause
              </th>
              <th class="px-3 py-2 font-normal">
                Try this
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800 bg-zinc-900/20">
            <tr
              v-for="s in cat.symptoms"
              :key="s.symptom"
              class="align-top"
            >
              <td class="px-3 py-2.5 text-zinc-200">
                {{ s.symptom }}
              </td>
              <td class="px-3 py-2.5 text-zinc-400">
                {{ s.likelyCause }}
              </td>
              <td class="px-3 py-2.5 text-green-300">
                {{ s.fix }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section
      v-if="relevantDiagnoses.length"
      class="mb-10"
    >
      <h2 class="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-zinc-400">
        Symptoms that point here
      </h2>
      <ul class="space-y-1.5">
        <li
          v-for="d in relevantDiagnoses"
          :key="d.symptom"
          class="card-subtle px-3 py-2 text-sm text-zinc-300"
        >
          <NuxtLink
            to="/tune/diagnose"
            class="hover:text-zinc-100"
          >
            {{ d.symptom }}
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section v-if="relatedCats.length">
      <h2 class="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-zinc-400">
        Related
      </h2>
      <div class="flex flex-wrap gap-2">
        <NuxtLink
          v-for="r in relatedCats"
          :key="r.slug"
          :to="`/tune/${r.slug}`"
          class="rounded-sm border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-300 transition-colors hover:border-green-500/60 hover:text-green-300"
        >
          {{ r.title }}
        </NuxtLink>
      </div>
    </section>
  </main>
</template>
