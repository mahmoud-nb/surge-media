<script setup lang="ts">
/**
 * Interrupteur — <UiSwitch v-model="active" :label="…" :description="…" />.
 * Case à cocher native avec role="switch" : Espace bascule, l'état (activé / désactivé)
 * est annoncé, et le libellé cliquable reste relié au contrôle.
 */
const props = defineProps<{
  label: string
  description?: string
  disabled?: boolean
  id?: string
}>()

const model = defineModel<boolean>({ default: false })
const generatedId = useId()
const controlId = computed(() => props.id ?? generatedId)
const descriptionId = computed(() => `${controlId.value}-description`)
</script>

<template>
  <div class="flex items-start gap-3">
    <span class="relative mt-0.5 inline-flex shrink-0">
      <input
        :id="controlId"
        v-model="model"
        type="checkbox"
        role="switch"
        :disabled="disabled"
        :aria-describedby="description ? descriptionId : undefined"
        class="peer absolute inset-0 z-10 size-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
      >
      <span
        class="flex h-6 w-11 items-center rounded-full border-2 border-input bg-muted p-0.5 transition-colors peer-checked:border-primary peer-checked:bg-primary peer-disabled:opacity-60 forced-colors:peer-checked:bg-[Highlight]"
        aria-hidden="true"
      >
        <span class="size-4 rounded-full bg-input shadow-xs transition-transform" />
      </span>
    </span>
    <span class="grid gap-0.5">
      <label :for="controlId" class="text-sm font-medium text-foreground" :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'">
        {{ label }}
      </label>
      <span v-if="description" :id="descriptionId" class="text-sm text-muted-foreground">
        {{ description }}
      </span>
    </span>
  </div>
</template>

<style scoped>
/* Position du curseur : dépend de l'état de la case, frère précédent du rail. */
input:checked + span > span {
  transform: translateX(1.25rem);
  background-color: var(--primary-foreground);
}
</style>
