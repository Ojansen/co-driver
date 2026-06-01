<script setup lang="ts">
/**
 * The one quick-create surface: an optional eyebrow title, a name field, and a
 * submit button. The parent owns persistence + post-create navigation via the
 * `submit` callback; this component owns the input model, busy state, and error
 * display so every create looks and behaves identically.
 */
const props = withDefaults(defineProps<{
  title?: string
  placeholder?: string
  label?: string
  busyLabel?: string
  submit: (name: string) => Promise<void>
}>(), {
  title: '',
  placeholder: '',
  label: 'Create',
  busyLabel: 'Creating…'
})

const name = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

async function onSubmit() {
  const trimmed = name.value.trim()
  if (!trimmed || busy.value) return
  busy.value = true
  error.value = null
  try {
    await props.submit(trimmed)
    name.value = ''
  } catch (err) {
    error.value = apiErrorMessage(err, 'create failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card p-4">
    <div
      v-if="title"
      class="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500"
    >
      {{ title }}
    </div>
    <form
      class="flex gap-2"
      @submit.prevent="onSubmit"
    >
      <UInput
        v-model="name"
        :placeholder="placeholder"
        :disabled="busy"
        class="flex-1"
        :ui="{ base: 'text-sm' }"
      />
      <UButton
        type="submit"
        :label="busy ? busyLabel : label"
        color="primary"
        :loading="busy"
        :disabled="busy || !name.trim()"
      />
    </form>
    <p
      v-if="error"
      class="mt-2 font-mono text-xs text-red-400"
    >
      {{ error }}
    </p>
  </section>
</template>
