<script setup lang="ts">
const { telemetry, connected, forzaConnected, hasReceivedFrame } = useTelemetry()
const { recording, stopRecording } = useRecording()
const { capabilities } = useGame()
const route = useRoute()

// Nav adapts to the active game: FH6-only sections (tuning) drop out when a
// game without that capability is selected, leaving the telemetry routes.
const navItems = computed(() => navForGame(capabilities.value))

// Pages opt out of the header on narrow viewports via
// `definePageMeta({ hideHeaderOnMobile: true })` — used by /live so a phone
// propped next to the TV gets full vertical space for telemetry. Those
// pages render their own floating hamburger using the same NAV_ITEMS.
const hideHeaderOnMobile = computed(() => !!route.meta.hideHeaderOnMobile)

const quickRecordOpen = ref(false)

const isRecording = computed(() => recording.value.state === 'recording')
const showQuickRecord = computed(() => !isRecording.value)
const lapsCompleted = computed(() =>
  recording.value.state === 'recording' ? recording.value.lapsCompleted : 0
)

// Picked-car validation data exposed in the banner so the driver can
// sanity-check what's being recorded mid-session.
const recCarLabel = computed<string>(() => {
  const r = recording.value
  if (r.state !== 'recording') return ''
  return r.carDisplayName ?? `#${r.carOrdinal}`
})
const recClassLabel = computed<string>(() => {
  const r = recording.value
  if (r.state !== 'recording') return ''
  return classForDisplay(r.piAtStart, r.carClass)
})
const recPi = computed<number | null>(() => {
  const r = recording.value
  return r.state === 'recording' ? r.piAtStart : null
})
const recTuneLabel = computed<string | null>(() => {
  const r = recording.value
  return r.state === 'recording' ? (r.tuneLabel ?? null) : null
})

// Recording duration — once-per-second tick, only while recording. Keeps
// the banner timer alive even when telemetry frames don't arrive (e.g.
// between events).
const recStartedAt = ref<number | null>(null)
const nowMs = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null

watch(isRecording, (rec) => {
  if (rec) {
    recStartedAt.value = Date.now()
    nowMs.value = Date.now()
    tick ??= setInterval(() => {
      nowMs.value = Date.now()
    }, 1000)
  } else {
    recStartedAt.value = null
    if (tick) {
      clearInterval(tick)
      tick = null
    }
  }
}, { immediate: true })
onBeforeUnmount(() => {
  if (tick) clearInterval(tick)
})

const recDuration = computed<string>(() => {
  const start = recStartedAt.value
  if (!start) return '0:00'
  const s = Math.max(0, Math.floor((nowMs.value - start) / 1000))
  const mm = Math.floor(s / 60)
  const ss = (s % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
})

// Update the tab title so it's obvious even when this tab isn't focused.
useHead({
  title: () => isRecording.value ? `● REC ${recDuration.value} · co-driver` : 'co-driver'
})
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <!-- Recording banner: hard to miss while driving. Lives above the
         normal header so it can't scroll out or get visually buried. -->
    <div
      v-if="isRecording"
      class="sticky top-0 z-30 border-b border-red-500/50 bg-gradient-to-b from-red-500/15 to-red-500/5 backdrop-blur"
    >
      <div class="pointer-events-none absolute inset-x-0 top-0 h-px animate-pulse bg-red-400/80" />
      <div class="container mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-2 font-mono">
        <div class="flex min-w-0 items-center gap-3 text-red-200">
          <span class="relative inline-flex items-center justify-center">
            <span class="absolute inline-block h-3 w-3 animate-ping rounded-full bg-red-400/60" />
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-red-400" />
          </span>
          <span class="text-xs uppercase tracking-[0.3em]">Recording</span>
          <span class="tabular-nums text-sm text-red-100">{{ recDuration }}</span>
          <span class="text-[10px] uppercase tracking-[0.2em] text-red-300/80">
            {{ lapsCompleted }} lap{{ lapsCompleted === 1 ? '' : 's' }}
          </span>
        </div>
        <!-- Identity strip — what's actually being captured -->
        <div class="hidden min-w-0 flex-1 items-center justify-center gap-3 text-[11px] text-red-100/90 md:flex">
          <span class="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.1em] text-red-200">
            {{ recClassLabel }}
          </span>
          <span
            class="truncate"
            :title="recCarLabel"
          >{{ recCarLabel }}</span>
          <span
            v-if="recPi !== null"
            class="tabular-nums text-red-300/80"
          >PI {{ recPi }}</span>
          <span
            v-if="recTuneLabel"
            class="truncate text-red-300/70"
            :title="`tune: ${recTuneLabel}`"
          >· {{ recTuneLabel }}</span>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-sm border border-red-500/60 bg-red-500/15 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-red-100 transition-colors hover:bg-red-500/30"
          @click="stopRecording"
        >
          Stop recording
        </button>
      </div>
    </div>

    <header
      class="sticky z-20 border-b border-zinc-800 bg-zinc-950/85 backdrop-blur"
      :class="[
        isRecording ? 'top-[44px]' : 'top-0',
        hideHeaderOnMobile ? 'max-sm:hidden [@media(max-height:500px)]:hidden' : ''
      ]"
    >
      <div class="container mx-auto flex max-w-6xl items-center justify-between px-6 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-400">
        <div class="flex items-center gap-3 sm:gap-6">
          <NuxtLink
            to="/live"
            class="text-zinc-100 transition-colors hover:text-zinc-50"
          >
            co-driver
          </NuxtLink>
          <!-- Hamburger — portrait phone only; opens the slide-in drawer.
               Inline UNavigationMenu below handles sm+ viewports. -->
          <AppMobileNav :items="navItems">
            <UButton
              icon="i-lucide-menu"
              variant="ghost"
              color="neutral"
              size="xs"
              aria-label="Open menu"
              class="sm:hidden"
            />
          </AppMobileNav>
          <!-- Desktop nav. Grouped items (Telemetry / Reference) render as
               dropdowns; the parent links keep their landing route one click
               away. Active state is matched from `to` automatically. -->
          <UNavigationMenu
            :items="navItems"
            class="hidden sm:flex"
          />
        </div>
        <div class="flex items-center gap-3 sm:gap-4">
          <button
            v-if="showQuickRecord"
            type="button"
            :aria-label="quickRecordOpen ? undefined : 'Quick record'"
            class="rounded-sm border border-green-500/40 bg-green-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-green-300 transition-colors hover:border-green-400/60 hover:bg-green-500/20 sm:px-2.5"
            @click="quickRecordOpen = true"
          >
            <span class="mr-1.5 inline-block h-1.5 w-1.5 align-middle rounded-full bg-green-400" />
            <span class="sm:hidden">Rec</span>
            <span class="hidden sm:inline">Quick record</span>
          </button>
          <span class="flex items-center gap-2">
            <span
              class="inline-block h-2 w-2 rounded-full"
              :class="!connected ? 'bg-zinc-600' : forzaConnected ? 'bg-green-400' : 'bg-amber-400 animate-pulse'"
            />
            <span class="hidden sm:inline">{{ !connected ? 'OFFLINE' : forzaConnected ? 'STREAMING' : 'NO TELEMETRY' }}</span>
          </span>
          <span
            v-if="hasReceivedFrame && telemetry"
            class="hidden tabular-nums text-zinc-500 sm:inline"
          >
            T+{{ (telemetry.timestampMs / 1000).toFixed(1) }}s
          </span>
        </div>
      </div>
    </header>
    <slot />

    <TunePromptModal />
    <QuickRecordModal v-model:open="quickRecordOpen" />
  </div>
</template>
