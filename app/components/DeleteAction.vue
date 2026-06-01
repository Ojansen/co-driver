<script setup lang="ts">
/**
 * One delete surface: a trigger button wired to the shared ConfirmModal plus the
 * DELETE request, busy state, and error display. The cascade/warning copy goes in
 * the default slot (rendered inside the modal body). Emits `deleted` with the
 * response so the parent can refresh or navigate.
 */
const props = withDefaults(defineProps<{
  url: string
  title: string
  confirmLabel?: string
  label?: string
  icon?: string
  color?: 'error' | 'primary' | 'neutral'
  variant?: 'solid' | 'outline' | 'soft' | 'subtle' | 'ghost' | 'link'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  block?: boolean
  triggerClass?: string
  triggerTitle?: string
  triggerAriaLabel?: string
}>(), {
  confirmLabel: 'Delete',
  label: '',
  icon: '',
  color: 'error',
  variant: 'ghost',
  size: 'sm',
  block: false,
  triggerClass: '',
  triggerTitle: '',
  triggerAriaLabel: ''
})

const emit = defineEmits<{ deleted: [result: unknown] }>()

defineOptions({ inheritAttrs: false })

const open = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

function openModal() {
  error.value = null
  open.value = true
}

async function confirm() {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch(props.url, { method: 'DELETE' })
    open.value = false
    emit('deleted', res)
  } catch (err) {
    error.value = apiErrorMessage(err, 'delete failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UButton
    :label="label || undefined"
    :icon="icon || undefined"
    :color="color"
    :variant="variant"
    :size="size"
    :block="block"
    :class="triggerClass"
    :title="triggerTitle || undefined"
    :aria-label="triggerAriaLabel || undefined"
    @click.stop.prevent="openModal"
  />
  <ConfirmModal
    v-model:open="open"
    :title="title"
    :confirm-label="confirmLabel"
    :busy="busy"
    @confirm="confirm"
  >
    <slot />
    <p
      v-if="error"
      class="mt-3 text-xs text-red-400"
    >
      {{ error }}
    </p>
  </ConfirmModal>
</template>
