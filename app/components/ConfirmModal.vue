<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  busyLabel?: string
  danger?: boolean
  busy?: boolean
}>(), {
  body: '',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  busyLabel: 'Deleting…',
  danger: true,
  busy: false
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': []
  'cancel': []
}>()

const cancelButton = ref<HTMLButtonElement | null>(null)

function close() {
  if (props.busy) return
  emit('cancel')
  emit('update:open', false)
}

function onConfirm() {
  if (props.busy) return
  emit('confirm')
}

// Auto-focus the safe button so a stray Enter doesn't trigger Delete.
watch(() => props.open, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  cancelButton.value?.focus()
}, { immediate: true })
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 px-4 backdrop-blur-sm"
    @click="close"
    @keydown.esc.stop="close"
  >
    <div
      class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 font-mono"
      role="dialog"
      aria-modal="true"
      @click.stop
    >
      <h2 class="mb-3 text-lg text-zinc-100">
        {{ title }}
      </h2>

      <div class="mb-5 text-sm text-zinc-400">
        <slot>
          {{ body }}
        </slot>
      </div>

      <div class="flex justify-end gap-2">
        <button
          ref="cancelButton"
          type="button"
          :disabled="busy"
          class="rounded-sm border border-zinc-700 bg-zinc-900 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          @click="close"
        >
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          :disabled="busy"
          class="rounded-sm border px-4 py-2 text-[11px] uppercase tracking-[0.2em] transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          :class="danger
            ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-400/60 hover:bg-red-500/20 focus:border-red-400/80'
            : 'border-green-500/40 bg-green-500/10 text-green-300 hover:border-green-400/60 hover:bg-green-500/20 focus:border-green-400/80'"
          @click="onConfirm"
        >
          {{ busy ? busyLabel : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
