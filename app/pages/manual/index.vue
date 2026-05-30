<script setup lang="ts">
useHead({ title: 'Manual · co-driver' })

// Landing for /manual/* — one card per surface. Each surface page has the
// in-context explanation of the visualizations that actually appear there;
// this index is just a directory.

interface Surface {
  slug: 'live' | 'replay' | 'compare' | 'hotlap'
  title: string
  page: string
  blurb: string
  graphs: string[]
}

const surfaces: Surface[] = [
  {
    slug: 'live',
    title: 'Live',
    page: '/live',
    blurb: 'Real-time chassis state while you drive. Per-tire panels around a center column of inputs and a chassis G-G dot.',
    graphs: ['G-G scatter', 'Friction circle (per tire)', 'Spring & damper gauge (per corner)', 'Diagnostic chips', 'Inputs + attitude readouts']
  },
  {
    slug: 'replay',
    title: 'Replay',
    page: 'session detail → "Replay"',
    blurb: 'Scrub a finished lap frame-by-frame. Everything live shows, plus whole-lap aggregates.',
    graphs: ['Damper velocity histogram (whole lap)', 'Damper position × velocity scatter', 'Ride-height histogram', 'RPM distribution', 'Slip-angle balance (understeer / oversteer)', 'Dyno curve (detailed mode, scrub needle)', 'Track map + cursor', 'Trace strips (inputs + motor)']
  },
  {
    slug: 'compare',
    title: 'Compare',
    page: '/events/<type>/<id>/compare',
    blurb: 'Side-by-side two laps from the same event. The glass-box "what changed" view.',
    graphs: ['Δ TIME (continuous delta-time vs distance)', 'Track map overlay (A · B)', 'A vs B damper histograms', 'A vs B damper scatter', 'A vs B ride-height histograms', 'A vs B dyno curves', 'A vs B slip-angle balance', 'A vs B tire temperature', 'Sector times + min-speed tables', 'Setup diff']
  },
  {
    slug: 'hotlap',
    title: 'Hotlap',
    page: '/hotlap',
    blurb: 'Driver-glance view: a giant clock, delta bar, F1-style sector cells, and a compact route.',
    graphs: ['Delta-to-best bar', 'Per-sector cells (F1 broadcast colors)', 'Predicted / theoretical lap', 'Compact track map']
  }
]
</script>

<template>
  <main class="container mx-auto max-w-6xl px-6 py-10">
    <PageHeader title="Manual">
      <template #eyebrow>
        <span class="text-zinc-300">Reading the graphs</span>
      </template>
      <template #intro>
        Each surface in the tool answers a different question. Pick the
        page you're looking at to read what each visualization shows, what
        the axes / colors mean, and what common shapes typically indicate.
      </template>
    </PageHeader>

    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <li
        v-for="s in surfaces"
        :key="s.slug"
      >
        <NuxtLink
          :to="`/manual/${s.slug}`"
          class="block card p-5 transition-colors hover:border-green-500/60 hover:bg-zinc-900/70"
        >
          <div class="mb-1 flex items-baseline justify-between gap-3">
            <h2 class="font-mono text-lg text-zinc-100">
              {{ s.title }}
            </h2>
            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {{ s.page }}
            </span>
          </div>
          <p class="mb-3 text-sm leading-relaxed text-zinc-300">
            {{ s.blurb }}
          </p>
          <ul class="flex flex-wrap gap-1.5">
            <li
              v-for="g in s.graphs"
              :key="g"
              class="rounded-sm border border-zinc-700/70 bg-zinc-900/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-400"
            >
              {{ g }}
            </li>
          </ul>
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>
