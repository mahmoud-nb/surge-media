<script setup lang="ts">
/**
 * Étiquette — <UiBadge variant="success">Actif</UiBadge>.
 * Le sens est porté par le texte ; la couleur n'est qu'un repère supplémentaire.
 */
import type { HTMLAttributes } from 'vue'

type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

const props = withDefaults(defineProps<{
  variant?: BadgeVariant
  class?: HTMLAttributes['class']
}>(), {
  variant: 'neutral',
})

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'border-input/60 bg-muted text-foreground',
  primary: 'border-primary/40 bg-primary-soft text-primary',
  success: 'border-success/40 bg-success-soft text-success',
  warning: 'border-warning/40 bg-warning-soft text-warning',
  danger: 'border-destructive/40 bg-destructive-soft text-destructive',
}
</script>

<template>
  <span :class="cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', VARIANTS[props.variant], props.class)">
    <slot />
  </span>
</template>
