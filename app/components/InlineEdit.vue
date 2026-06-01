<script setup lang="ts">
/**
 * Toggle-to-edit for a single text field. The parent renders the read view via
 * the `display` slot (which receives an `edit` trigger); this component owns the
 * draft, busy state, error, and the input + Save/Cancel affordances. Empty input
 * normalises to `null`. With `autosave-on-blur` it commits on blur/Enter and
 * drops the explicit buttons (used for the lightweight inline tune label).
 */
const props = withDefaults(defineProps<{
  value: string | null
  placeholder?: string
  save: (next: string | null) => Promise<void>
  autosaveOnBlur?: boolean
  inputClass?: string
  inputUi?: Record<string, string>
}>(), {
  placeholder: '',
  autosaveOnBlur: false,
  inputClass: '',
  inputUi: undefined
})

const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

function startEdit() {
  if (saving.value) return
  draft.value = props.value ?? ''
  error.value = null
  editing.value = true
}

function cancel() {
  editing.value = false
  draft.value = ''
  error.value = null
}

async function commit() {
  if (saving.value) return
  const trimmed = draft.value.trim()
  const next = trimmed.length ? trimmed : null
  saving.value = true
  error.value = null
  try {
    await props.save(next)
    editing.value = false
  } catch (err) {
    error.value = apiErrorMessage(err, 'save failed')
  } finally {
    saving.value = false
  }
}

function onBlur() {
  if (props.autosaveOnBlur) commit()
}
</script>

<template>
  <div>
    <slot
      v-if="!editing"
      name="display"
      :edit="startEdit"
      :value="value"
    />
    <div
      v-else
      class="flex items-center gap-2"
    >
      <UInput
        v-model="draft"
        :placeholder="placeholder"
        :disabled="saving"
        autofocus
        :class="['min-w-0 flex-1', inputClass]"
        :ui="inputUi"
        @keydown.enter.prevent="commit"
        @keydown.escape.prevent="cancel"
        @blur="onBlur"
      />
      <template v-if="!autosaveOnBlur">
        <UButton
          :label="saving ? 'Saving…' : 'Save'"
          color="primary"
          :loading="saving"
          :disabled="saving"
          @click="commit"
        />
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          :disabled="saving"
          @click="cancel"
        />
      </template>
    </div>
    <p
      v-if="error"
      class="mt-1 font-mono text-xs text-red-400"
    >
      {{ error }}
    </p>
  </div>
</template>
