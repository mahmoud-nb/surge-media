<script setup lang="ts">
/**
 * Boîte de dialogue modale — élément <dialog> natif (showModal) :
 * focus piégé dans la boîte, arrière-plan inerte, Échap ferme, rendu au-dessus de tout.
 * À la fermeture, le focus revient sur l'élément qui l'a ouverte.
 *
 *   <UiDialog v-model:open="confirmOpen" :title="…" :description="…">
 *     <template #actions>
 *       <UiButton variant="outline" autofocus @click="confirmOpen = false">Annuler</UiButton>
 *       <UiButton variant="destructive" @click="remove">Supprimer</UiButton>
 *     </template>
 *   </UiDialog>
 *
 * Pour une action destructive, placez `autofocus` sur le bouton d'annulation.
 * `return-focus=false` (évalué à la fermeture) : l'appelant place lui-même le focus, par exemple
 * quand l'action a changé le sens du bouton d'ouverture.
 */
const props = withDefaults(defineProps<{
  title: string
  description?: string
  returnFocus?: boolean
}>(), { returnFocus: true })

const open = defineModel<boolean>('open', { default: false })
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const descriptionId = useId()
let opener: HTMLElement | null = null

watch(open, (value) => {
  const element = dialog.value
  if (!element) return
  if (value && !element.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
  }
  else if (!value && element.open) {
    element.close()
  }
})

/** Fermeture (bouton, Échap ou close()) : synchronise l'état et rend le focus. */
function onClose() {
  open.value = false
  if (props.returnFocus) opener?.focus()
  opener = null
}
</script>

<template>
  <dialog
    ref="dialog"
    :aria-labelledby="titleId"
    :aria-describedby="props.description ? descriptionId : undefined"
    class="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface p-6 text-foreground shadow-xl backdrop:bg-black/50"
    @close="onClose"
  >
    <h2 :id="titleId" class="text-lg font-semibold">
      {{ title }}
    </h2>
    <p v-if="description" :id="descriptionId" class="mt-2 text-sm text-muted-foreground">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
    <div class="mt-6 flex flex-wrap justify-end gap-3">
      <slot name="actions" />
    </div>
  </dialog>
</template>
