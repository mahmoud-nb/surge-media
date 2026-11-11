<script setup lang="ts">
/**
 * Section repliable « Téléverser des médias » (page « Médias », médias d'un projet) : motif
 * « disclosure » de l'ARIA APG — un titre qui contient un bouton `aria-expanded` relié au panneau par
 * `aria-controls`. Repliée par défaut pour laisser la place à la liste ; ouverte d'emblée quand
 * l'espace est vide (rien d'autre à montrer). Le contenu reste monté une fois replié (`v-show`) : un
 * envoi en cours continue et la liste se met à jour à la fin.
 *
 *   <AdminUploadPanel :default-open="empty"> …envoyeur… </AdminUploadPanel>
 */
import { ChevronDown, Upload } from '@lucide/vue'

const props = defineProps<{
  /** Ouverte au premier affichage. */
  defaultOpen?: boolean
}>()

const { t } = useI18n()
const open = ref(Boolean(props.defaultOpen))
const titleId = useId()
const panelId = useId()
</script>

<template>
  <section :aria-labelledby="titleId" class="mb-8 rounded-xl border border-border bg-surface">
    <h2 :id="titleId" class="text-lg font-semibold text-foreground">
      <button
        type="button"
        :aria-expanded="open"
        :aria-controls="panelId"
        class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        @click="open = !open"
      >
        <Upload class="size-5 shrink-0 text-primary" aria-hidden="true" />
        <span class="flex-1">{{ t('media.upload.title') }}</span>
        <ChevronDown :class="cn('size-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')" aria-hidden="true" />
      </button>
    </h2>
    <div v-show="open" :id="panelId" class="border-t border-border p-4">
      <slot />
    </div>
  </section>
</template>
