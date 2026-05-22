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
  <main class="mx-auto max-w-3xl px-6 py-10">
    <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
      <NuxtLink
        to="/tune"
        class="hover:text-zinc-300"
      >
        Tuning reference
      </NuxtLink>
      <span class="mx-2 text-zinc-700">/</span>
      <span class="text-zinc-300">{{ cat.slug }}</span>
    </div>

    <div class="mb-2 flex items-center gap-3">
      <UIcon
        :name="`i-lucide-${cat.icon}`"
        class="h-6 w-6 text-zinc-400"
      />
      <h1 class="font-mono text-3xl text-zinc-100">
        {{ cat.title }}
      </h1>
    </div>
    <p class="mb-10 font-mono text-sm leading-relaxed text-zinc-300">
      {{ cat.summary }}
    </p>

    <YourDataPanel :slug="slug" />

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
          class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
        >
          <div class="mb-1 font-mono text-sm text-zinc-100">
            {{ ctrl.name }}
          </div>
          <div class="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Range: {{ ctrl.range }}
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div class="rounded-md border border-amber-900/30 bg-amber-950/10 p-2.5 text-sm">
              <div class="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400/70">
                Raise →
              </div>
              <div class="text-zinc-300">
                {{ ctrl.raises }}
              </div>
            </div>
            <div class="rounded-md border border-sky-900/30 bg-sky-950/10 p-2.5 text-sm">
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
          class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
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
      <div class="overflow-hidden rounded-lg border border-zinc-800">
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
          class="rounded-md border border-zinc-800/80 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-300"
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
