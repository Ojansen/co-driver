<script setup lang="ts">
// Shared "waiting for telemetry" placeholder. Two shapes:
//   - variant="full"  — centred in the viewport, used on the phone-as-sidecar
//     pages (/live, /hotlap) where the whole screen is the readout.
//   - variant="card"  — a dashed card that slots into a normal page flow
//     (/dyno, /cars) above or in place of the real content.
// The radar rings are pure CSS (animate-ping) so there's no JS cost while a
// page sits idle waiting for the first frame.
withDefaults(defineProps<{
  title?: string
  /** WS link state — renders a live dot + "linked/offline" when provided. */
  connected?: boolean
  variant?: 'full' | 'card'
}>(), {
  title: 'Waiting for telemetry',
  connected: undefined,
  variant: 'card'
})
</script>

<template>
  <div
    :class="variant === 'full'
      ? 'flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center sm:py-24'
      : 'card-dashed flex flex-col items-center justify-center px-6 py-12 text-center'"
  >
    <!-- Radar: a radio glyph with two concentric rings pinging outward. -->
    <div class="relative flex h-16 w-16 items-center justify-center">
      <span class="absolute inline-flex h-full w-full animate-ping rounded-full border border-green-500/30 [animation-duration:2.4s]" />
      <span class="absolute inline-flex h-2/3 w-2/3 animate-ping rounded-full border border-green-500/40 [animation-duration:2.4s] [animation-delay:0.6s]" />
      <span class="absolute inline-flex h-10 w-10 rounded-full bg-green-500/5" />
      <UIcon
        name="i-lucide-radio"
        class="relative h-7 w-7 text-green-400/80"
      />
    </div>

    <div
      :class="variant === 'full'
        ? 'mt-6 font-mono text-2xl uppercase tracking-[0.2em] text-zinc-100'
        : 'mt-5 font-mono text-lg text-zinc-100'"
    >
      {{ title }}
    </div>

    <p class="mt-3 max-w-md font-mono text-xs leading-relaxed text-zinc-400">
      <slot>
        Start a race in Forza Horizon with Data Out enabled
        (Settings → HUD and Gameplay → Data Out) and point it at this server's
        LAN IP, port <span class="text-zinc-200">5300</span>, format
        <span class="text-zinc-200">Car Dash</span>.
      </slot>
    </p>

    <!-- Connection pill — only when the parent passes a link state. -->
    <div
      v-if="connected !== undefined"
      class="mt-5 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500"
    >
      <span
        class="inline-block h-1.5 w-1.5 rounded-full transition-colors"
        :class="connected ? 'animate-pulse bg-green-400' : 'bg-zinc-600'"
      />
      {{ connected ? 'WS linked' : 'WS offline' }}
    </div>
  </div>
</template>
