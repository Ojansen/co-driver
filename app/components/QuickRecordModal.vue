<script setup lang="ts">
import { EVENT_TYPE_LABELS, EVENT_TYPE_ORDER, type EventType } from '~/utils/event-types'

const open = defineModel<boolean>('open', { required: true })

interface EventRow {
  id: number
  name: string
  type: EventType | null
  createdAt: number | string
  bestLapMs: number | null
  lastDrivenAt: number | string | null
}

const { startRecording, lastError, clearError } = useRecording()
// The active game (workspace) the recording is tagged with. Forza Horizon has
// the discipline taxonomy (rally/touge/…); every other sim is "simple mode":
// an event is just a track/race name, recorded with no discipline tag.
const { gameId, capabilities } = useGame()
const simpleMode = computed(() => !capabilities.value.tuning)

const step = ref<'type' | 'event'>('type')
const selectedType = ref<EventType | null>(null)
const selectedEventId = ref<number | null>(null)
const newEventName = ref('')
const tuneLabel = ref('')

const eventsForType = ref<EventRow[]>([])
const loadingEvents = ref(false)
const creating = ref(false)
const submitting = ref(false)
const localError = ref<string | null>(null)

function reset() {
  step.value = 'type'
  selectedType.value = null
  selectedEventId.value = null
  newEventName.value = ''
  tuneLabel.value = ''
  eventsForType.value = []
  loadingEvents.value = false
  creating.value = false
  submitting.value = false
  localError.value = null
}

function close() {
  open.value = false
  reset()
  clearError()
}

watch(open, (v) => {
  if (!v) return
  reset()
  clearError()
  // Simple mode skips the discipline step: list all the game's events and let
  // the user pick or create one by name (no discipline tag).
  if (simpleMode.value) {
    step.value = 'event'
    void loadEvents(null)
  }
})

async function loadEvents(t: EventType | null) {
  loadingEvents.value = true
  localError.value = null
  try {
    const query = t ? { type: t, gameId: gameId.value } : { gameId: gameId.value }
    eventsForType.value = await $fetch<EventRow[]>('/api/events', { query })
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    localError.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'failed to load events'
  } finally {
    loadingEvents.value = false
  }
}

async function pickType(t: EventType) {
  selectedType.value = t
  step.value = 'event'
  selectedEventId.value = null
  newEventName.value = ''
  await loadEvents(t)
}

async function createAndStart() {
  const name = newEventName.value.trim()
  if (!name) return
  creating.value = true
  localError.value = null
  try {
    // Forza tags a discipline (selectedType from the tile step); other sims omit it.
    const body: Record<string, unknown> = { name, gameId: gameId.value }
    if (selectedType.value) body.type = selectedType.value
    const created = await $fetch<EventRow>('/api/events', { method: 'POST', body })
    selectedEventId.value = created.id
    eventsForType.value = [...eventsForType.value, created]
    newEventName.value = ''
    await startAndClose()
  } catch (err) {
    const e = err as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
    localError.value = e.data?.statusMessage ?? e.statusMessage ?? e.message ?? 'create failed'
  } finally {
    creating.value = false
  }
}

async function startAndClose() {
  if (!selectedEventId.value) return
  submitting.value = true
  localError.value = null
  const label = tuneLabel.value.trim() || null
  const ok = startRecording(selectedEventId.value, label)
  submitting.value = false
  if (!ok) {
    localError.value = 'WebSocket not connected'
    return
  }
  // server may bounce back an error async; let the user see it before navigating.
  await nextTick()
  if (lastError.value) {
    localError.value = lastError.value
    return
  }
  close()
  await navigateTo('/live')
}

const eventItems = computed(() => eventsForType.value.map(ev => ({ label: ev.name, value: ev.id })))

// USelect's model rejects null — bridge null <-> undefined.
const selectedEventModel = computed({
  get: () => selectedEventId.value ?? undefined,
  set: (v: number | undefined) => { selectedEventId.value = v ?? null }
})

function back() {
  step.value = 'type'
  selectedEventId.value = null
  newEventName.value = ''
  eventsForType.value = []
}

// Heading for the event step: a plain "Quick record" for the name-only flow,
// the Forza event-type label otherwise.
const eventStepTitle = computed(() => (simpleMode.value ? 'Quick record' : EVENT_TYPE_LABELS[selectedType.value ?? 'race']))
const newEventPlaceholder = computed(() =>
  simpleMode.value
    ? 'e.g. Spa-Francorchamps'
    : `new ${EVENT_TYPE_LABELS[selectedType.value ?? 'race'].toLowerCase()} event`
)
</script>

<template>
  <UiModal
    :open="open"
    :title="step === 'type' ? 'Quick record' : eventStepTitle"
    size="lg"
    @close="close"
  >
    <header class="mb-4 flex items-center justify-between">
      <div>
        <div class="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
          Quick record
        </div>
        <h2 class="mt-1 text-xl text-zinc-100">
          {{ step === 'type' ? 'Pick a type' : eventStepTitle }}
        </h2>
      </div>
      <UButton
        label="Close"
        color="neutral"
        variant="outline"
        size="xs"
        class="font-mono text-[10px] uppercase tracking-[0.2em]"
        @click="close"
      />
    </header>

    <!-- Step 1: type tiles (Forza only — simple mode jumps to the name step) -->
    <div
      v-if="step === 'type'"
      class="grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
      <UButton
        v-for="t in EVENT_TYPE_ORDER"
        :key="t"
        :label="EVENT_TYPE_LABELS[t]"
        color="neutral"
        variant="outline"
        block
        class="justify-start px-3 py-4 text-sm"
        @click="pickType(t)"
      />
    </div>

    <!-- Step 2: event picker + tune label + start -->
    <div
      v-else
      class="space-y-3"
    >
      <UButton
        v-if="!simpleMode"
        label="← back to types"
        color="neutral"
        variant="link"
        size="xs"
        :padded="false"
        class="font-mono text-[10px] uppercase tracking-[0.2em]"
        @click="back"
      />

      <div
        v-if="loadingEvents"
        class="text-sm text-zinc-500"
      >
        Loading…
      </div>
      <div
        v-else-if="eventsForType.length > 0"
        class="space-y-1"
      >
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Pick existing
        </div>
        <USelect
          v-model="selectedEventModel"
          :items="eventItems"
          placeholder="— select an event —"
          class="w-full text-sm"
        />
      </div>

      <div class="space-y-1">
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          …or create new
        </div>
        <form
          class="flex gap-2"
          @submit.prevent="createAndStart"
        >
          <UInput
            v-model="newEventName"
            :placeholder="newEventPlaceholder"
            :disabled="creating || submitting"
            class="flex-1"
            :ui="{ base: 'text-sm' }"
          />
          <UButton
            type="submit"
            :label="creating ? '…' : 'Create & start'"
            color="neutral"
            variant="outline"
            :disabled="creating || submitting || !newEventName.trim()"
            class="font-mono text-[10px] uppercase tracking-[0.2em]"
          />
        </form>
      </div>

      <div class="space-y-1">
        <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          {{ simpleMode ? 'Label (optional)' : 'Tune label (optional)' }}
        </div>
        <UInput
          v-model="tuneLabel"
          :placeholder="simpleMode ? 'e.g. soft tyres, qualifying sim' : 'e.g. race build v2'"
          :disabled="creating || submitting"
          class="w-full"
          :ui="{ base: 'text-sm' }"
        />
      </div>

      <div
        v-if="localError"
        class="rounded-sm border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300"
      >
        {{ localError }}
      </div>

      <div class="flex justify-end">
        <UButton
          :label="submitting ? 'Starting…' : 'Start recording'"
          color="primary"
          variant="subtle"
          :loading="submitting"
          :disabled="!selectedEventId || submitting || creating"
          class="font-mono text-[11px] uppercase tracking-[0.2em]"
          @click="startAndClose"
        >
          <template #leading>
            <span class="inline-block h-2 w-2 rounded-full bg-green-400" />
          </template>
        </UButton>
      </div>
    </div>
  </UiModal>
</template>
