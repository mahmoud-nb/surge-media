<script setup lang="ts">
/**
 * Identifiant d'API tout juste créé (jeton personnel, clé secrète ou publique) : valeur à copier,
 * affichée une seule fois pour les secrets (seule l'empreinte est conservée). À son apparition,
 * le focus est placé sur le titre pour que les lecteurs d'écran l'annoncent.
 */
import { TriangleAlert } from '@lucide/vue'

defineProps<{
  title: string
  description: string
  label: string
  value: string
  /** Secret : avertissement « ne sera plus affiché ». */
  secret?: boolean
}>()

const { t } = useI18n()
const titleId = useId()
const heading = useTemplateRef<HTMLHeadingElement>('heading')

function focus() {
  heading.value?.focus()
}

onMounted(focus)
// Pour replacer le focus après un rechargement de la page appelante (ex. bouton disparu).
defineExpose({ focus })
</script>

<template>
  <section :aria-labelledby="titleId" class="grid gap-4 rounded-xl border border-primary/40 bg-primary-soft p-5">
    <div class="grid gap-1">
      <h2 :id="titleId" ref="heading" tabindex="-1" class="font-semibold text-foreground">
        {{ title }}
      </h2>
      <p class="text-sm text-foreground">
        {{ description }}
      </p>
    </div>

    <UiCopyField :label="label" :value="value" />

    <p v-if="secret" class="flex items-start gap-2 text-sm font-medium text-foreground">
      <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      {{ t('credentials.secretOnce') }}
    </p>
  </section>
</template>
