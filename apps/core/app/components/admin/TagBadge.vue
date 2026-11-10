<script setup lang="ts">
/**
 * Étiquette d'un média (architecture-tags.md, TG13) : nom écrit, fond et texte de sa teinte (jetons
 * `--tag-<teinte>-bg` / `-fg`, contrastes vérifiés en clair et en sombre) ; une étiquette confidentielle
 * porte un cadenas doublé d'un texte pour les lecteurs d'écran. La couleur n'est jamais la seule information.
 */
import { Lock } from '@lucide/vue'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  tag: { name: string, color: string, confidential?: boolean }
  class?: HTMLAttributes['class']
}>()

const { t } = useI18n()
const color = computed(() => ((TAG_COLORS as readonly string[]).includes(props.tag.color) ? props.tag.color : TAG_DEFAULT_COLOR))
const style = computed(() => ({
  backgroundColor: `var(--tag-${color.value}-bg)`,
  color: `var(--tag-${color.value}-fg)`,
  borderColor: `color-mix(in srgb, var(--tag-${color.value}-fg) 40%, transparent)`,
}))
</script>

<template>
  <span :class="cn('inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold', props.class)" :style="style">
    <Lock v-if="tag.confidential" class="size-3 shrink-0" aria-hidden="true" />
    <span class="truncate">{{ tag.name }}</span>
    <span v-if="tag.confidential" class="sr-only">{{ t('tags.confidentialSuffix') }}</span>
  </span>
</template>
