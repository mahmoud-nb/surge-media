<script setup lang="ts">
/**
 * Bouton — <UiButton>.
 * Rendu en <button> (type="button" par défaut) ou en lien <NuxtLink> si `to` est fourni
 * (`external` : lien ordinaire, hors routeur — fichier, route serveur).
 * `loading` garde le bouton focalisable (aria-disabled plutôt que disabled) et bloque
 * l'action ; annoncez l'état via une région live du formulaire.
 */
import { LoaderCircle } from '@lucide/vue'
import type { HTMLAttributes } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const props = withDefaults(defineProps<{
  variant?: ButtonVariant
  size?: ButtonSize
  type?: 'button' | 'submit' | 'reset'
  to?: RouteLocationRaw
  external?: boolean
  loading?: boolean
  disabled?: boolean
  class?: HTMLAttributes['class']
}>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
})

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
  secondary: 'bg-muted text-foreground hover:bg-border',
  outline: 'border border-input bg-surface text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
  destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive-hover',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-6 text-base',
  icon: 'size-10',
}

const classes = computed(() => cn(
  'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors select-none',
  'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-wait',
  '[&_svg]:size-4 [&_svg]:shrink-0',
  VARIANTS[props.variant],
  SIZES[props.size],
  props.class,
))

function onClick(event: MouseEvent) {
  // Pendant le chargement : pas de double soumission, mais le focus reste sur le bouton.
  if (props.loading) event.preventDefault()
}
</script>

<template>
  <NuxtLink v-if="to" :to="to" :external="external" :class="classes">
    <slot />
  </NuxtLink>
  <button
    v-else
    :type="type"
    :class="classes"
    :disabled="disabled"
    :aria-disabled="loading || undefined"
    @click="onClick"
  >
    <LoaderCircle v-if="loading" class="animate-spin" aria-hidden="true" />
    <slot />
  </button>
</template>
