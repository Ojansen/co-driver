<script setup lang="ts">
import type { NavItem } from '~/utils/nav'

// Mobile navigation: a hamburger trigger that opens a left slide-in drawer
// holding the full nav as a vertical UNavigationMenu (groups become
// collapsible sections). Replaces the old little UDropdownMenu. The trigger
// button is passed in via the default slot so each call site keeps full
// control of its styling/positioning (inline in the header vs. floating on
// the header-less /live and /hotlap pages).
defineProps<{
  items: NavItem[]
}>()

const open = ref(false)
const route = useRoute()

// Tapping a link navigates but doesn't dismiss the overlay on its own —
// close the drawer whenever the route changes.
watch(() => route.fullPath, () => {
  open.value = false
})
</script>

<template>
  <USlideover
    v-model:open="open"
    side="left"
    title="co-driver"
    :ui="{ content: 'max-w-xs' }"
  >
    <slot />

    <template #body>
      <UNavigationMenu
        :items="items"
        orientation="vertical"
        class="-mx-2.5"
      />
    </template>
  </USlideover>
</template>
