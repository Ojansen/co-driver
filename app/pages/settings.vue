<script setup lang="ts">
import type { UnitPrefs } from '~/composables/useUnits'
import type { ClusterStyle } from '~/composables/useDisplayPrefs'

useHead({ title: 'Settings · co-driver' })

const { prefs, applyPreset } = useUnits()
const { prefs: displayPrefs } = useDisplayPrefs()

const CLUSTER_OPTIONS: { value: ClusterStyle, label: string, hint: string }[] = [
  { value: 'twin', label: 'Twin dial', hint: 'analog · tach + speedo' },
  { value: 'digital', label: 'Rev arc', hint: 'digital · top bar + digits' }
]

function setCluster(value: ClusterStyle) {
  displayPrefs.value = { ...displayPrefs.value, cluster: value }
}

interface Category {
  key: keyof UnitPrefs
  label: string
  options: Array<{ value: UnitPrefs[keyof UnitPrefs], label: string, hint?: string }>
}

const CATEGORIES: Category[] = [
  {
    key: 'speed',
    label: 'Speed',
    options: [
      { value: 'kmh', label: 'km/h' },
      { value: 'mph', label: 'mph' }
    ]
  },
  {
    key: 'temperature',
    label: 'Temperature',
    options: [
      { value: 'c', label: '°C' },
      { value: 'f', label: '°F' }
    ]
  },
  {
    key: 'pressure',
    label: 'Tire pressure',
    options: [
      { value: 'psi', label: 'psi' },
      { value: 'bar', label: 'bar' },
      { value: 'kpa', label: 'kPa' }
    ]
  },
  {
    key: 'distance',
    label: 'Distance',
    options: [
      { value: 'metric', label: 'Metric', hint: 'mm · m · km' },
      { value: 'imperial', label: 'Imperial', hint: 'in · ft · mi' }
    ]
  },
  {
    key: 'springRate',
    label: 'Spring rate',
    options: [
      { value: 'lbin', label: 'lb/in' },
      { value: 'nmm', label: 'N/mm' },
      { value: 'kgfmm', label: 'kgf/mm' }
    ]
  },
  {
    key: 'downforce',
    label: 'Downforce',
    options: [
      { value: 'lb', label: 'lb' },
      { value: 'kgf', label: 'kgf' }
    ]
  },
  {
    key: 'power',
    label: 'Power',
    options: [
      { value: 'kw', label: 'kW' },
      { value: 'hp', label: 'hp' },
      { value: 'ps', label: 'PS' }
    ]
  },
  {
    key: 'torque',
    label: 'Torque',
    options: [
      { value: 'nm', label: 'Nm' },
      { value: 'lbft', label: 'lb-ft' }
    ]
  },
  {
    key: 'mass',
    label: 'Mass / weight',
    options: [
      { value: 'kg', label: 'kg' },
      { value: 'lb', label: 'lb' }
    ]
  },
  {
    key: 'boost',
    label: 'Engine boost',
    options: [
      { value: 'bar', label: 'bar' },
      { value: 'psi', label: 'psi' },
      { value: 'atm', label: 'atm' }
    ]
  }
]

function setValue<K extends keyof UnitPrefs>(key: K, value: UnitPrefs[K]) {
  prefs.value = { ...prefs.value, [key]: value }
}
</script>

<template>
  <main class="container mx-auto max-w-3xl px-6 py-10">
    <PageHeader title="Settings">
      <template #eyebrow>
        <span>Display &amp; units</span>
      </template>
      <template #intro>
        Pick how values are displayed across telemetry panels and tune forms.
        Data on disk stays in Forza's native units (km/h, °C, psi, lb/in, lb,
        kW, Nm, meters) — only display and form-input conversion changes.
      </template>
    </PageHeader>

    <section class="card mb-6 p-4 font-mono">
      <div class="mb-3 text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        Instrument cluster
      </div>
      <div
        role="radiogroup"
        aria-label="Instrument cluster style"
        class="flex flex-wrap gap-1.5"
      >
        <button
          v-for="opt in CLUSTER_OPTIONS"
          :key="opt.value"
          type="button"
          role="radio"
          :aria-checked="displayPrefs.cluster === opt.value"
          class="rounded-sm border px-2.5 py-1 text-xs tabular-nums transition-colors"
          :class="displayPrefs.cluster === opt.value
            ? 'border-green-500/60 bg-green-500/10 text-green-200'
            : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'"
          @click="setCluster(opt.value)"
        >
          <span>{{ opt.label }}</span>
          <span class="ml-1.5 text-[10px] uppercase tracking-[0.15em] text-zinc-500">{{ opt.hint }}</span>
        </button>
      </div>
    </section>

    <section class="card mb-6 p-4 font-mono">
      <div class="mb-3 text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        Presets
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-sm border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          @click="applyPreset('metric')"
        >
          Set all to metric
        </button>
        <button
          type="button"
          class="rounded-sm border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          @click="applyPreset('imperial')"
        >
          Set all to imperial
        </button>
      </div>
    </section>

    <section class="card p-4 font-mono">
      <div class="mb-3 text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        Per-category
      </div>
      <dl class="divide-y divide-zinc-800/60">
        <div
          v-for="cat in CATEGORIES"
          :key="cat.key"
          class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-[1fr_2fr]"
        >
          <dt class="text-sm text-zinc-300">
            {{ cat.label }}
          </dt>
          <dd
            role="radiogroup"
            :aria-label="cat.label"
            class="flex flex-wrap gap-1.5"
          >
            <button
              v-for="opt in cat.options"
              :key="String(opt.value)"
              type="button"
              role="radio"
              :aria-checked="prefs[cat.key] === opt.value"
              class="rounded-sm border px-2.5 py-1 text-xs tabular-nums transition-colors"
              :class="prefs[cat.key] === opt.value
                ? 'border-green-500/60 bg-green-500/10 text-green-200'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'"
              @click="setValue(cat.key, opt.value as UnitPrefs[typeof cat.key])"
            >
              <span>{{ opt.label }}</span>
              <span
                v-if="opt.hint"
                class="ml-1.5 text-[10px] uppercase tracking-[0.15em] text-zinc-500"
              >{{ opt.hint }}</span>
            </button>
          </dd>
        </div>
      </dl>
    </section>
  </main>
</template>
