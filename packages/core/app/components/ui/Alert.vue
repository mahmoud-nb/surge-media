<script setup lang="ts">
/**
 * Message contextuel — <UiAlert>.
 * `live="assertive"` (role="alert") pour une erreur à annoncer immédiatement,
 * `live="polite"` (role="status") pour une confirmation, `off` pour un contenu statique.
 */
import { CircleAlert, CircleCheck, Info, TriangleAlert } from '@lucide/vue'
import type { HTMLAttributes } from 'vue'

type AlertVariant = 'info' | 'success' | 'warning' | 'error'

const props = withDefaults(defineProps<{
  variant?: AlertVariant
  title?: string
  live?: 'assertive' | 'polite' | 'off'
  class?: HTMLAttributes['class']
}>(), {
  variant: 'info',
  live: 'off',
})

const STYLES: Record<AlertVariant, { box: string, accent: string, icon: typeof Info }> = {
  info: { box: 'border-primary/40 bg-primary-soft', accent: 'text-primary', icon: Info },
  success: { box: 'border-success/40 bg-success-soft', accent: 'text-success', icon: CircleCheck },
  warning: { box: 'border-warning/40 bg-warning-soft', accent: 'text-warning', icon: TriangleAlert },
  error: { box: 'border-destructive/40 bg-destructive-soft', accent: 'text-destructive', icon: CircleAlert },
}

const style = computed(() => STYLES[props.variant])
const role = computed(() => ({ assertive: 'alert', polite: 'status', off: undefined })[props.live])
</script>

<template>
  <div :role="role" :class="cn('flex gap-3 rounded-lg border p-4 text-sm text-foreground', style.box, props.class)">
    <component :is="style.icon" :class="cn('mt-0.5 size-5 shrink-0', style.accent)" aria-hidden="true" />
    <div class="grid gap-1">
      <p v-if="title" :class="cn('font-semibold', style.accent)">
        {{ title }}
      </p>
      <div><slot /></div>
    </div>
  </div>
</template>
