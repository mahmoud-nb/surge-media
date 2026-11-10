<script setup lang="ts">
/**
 * Champs d'une étiquette (création et modification) : nom, identifiant (slug, proposé d'après le nom et
 * inchangé par un renommage), teinte (boutons radio dont chaque libellé montre la teinte et la nomme),
 * confidentialité (seulement pour qui peut la voir). Validation par `createTagSchema` / `updateTagSchema`.
 *
 *   <AdminTagForm v-model="form" :errors="errors" :can-confidential="…" />
 */
import { Lock } from '@lucide/vue'
import type { TagFormValue } from '~/composables/useTagLabels'

const props = defineProps<{
  /** Messages d'erreur déjà traduits, par champ. */
  errors?: Partial<Record<'name' | 'slug' | 'color', string>>
  canConfidential: boolean
  /** Modification : le slug n'est plus proposé d'après le nom. */
  editing?: boolean
  /** Préfixe des identifiants des champs (deux formulaires sur la même page). */
  idPrefix: string
}>()

const model = defineModel<TagFormValue>({ required: true })
const { t } = useI18n()
const { colorOptions } = useTagLabels()
const colorName = useId()

/** Slug proposé tant que l'utilisateur ne l'a pas saisi lui-même (création seulement). */
const slugEdited = ref(props.editing)
watch(() => model.value.name, (name) => {
  if (!slugEdited.value) model.value.slug = tagSlug(name)
})
</script>

<template>
  <div class="grid gap-4">
    <UiFormField :id="`${idPrefix}-name`" v-slot="field" :label="t('tags.fields.name')" :error="errors?.name" required>
      <UiInput v-bind="field" v-model="model.name" name="name" autocomplete="off" :maxlength="TAG_NAME_MAX_LENGTH" />
    </UiFormField>
    <UiFormField :id="`${idPrefix}-slug`" v-slot="field" :label="t('tags.fields.slug')" :hint="editing ? t('tags.fields.slugEditHint') : t('tags.fields.slugHint')" :error="errors?.slug">
      <UiInput v-bind="field" v-model="model.slug" name="slug" autocomplete="off" spellcheck="false" :maxlength="TAG_SLUG_MAX_LENGTH" class="font-mono" @input="slugEdited = true" />
    </UiFormField>
    <fieldset class="grid gap-2">
      <legend class="mb-1 text-sm font-medium text-foreground">
        {{ t('tags.fields.color') }}
      </legend>
      <div class="flex flex-wrap gap-2">
        <label
          v-for="option in colorOptions"
          :key="option.value"
          class="flex cursor-pointer items-center gap-2 rounded-lg border border-input bg-surface px-2.5 py-1.5 text-sm has-checked:border-2 has-checked:border-primary"
        >
          <input v-model="model.color" type="radio" :name="colorName" :value="option.value" class="size-4 accent-primary">
          <AdminTagBadge :tag="{ name: option.label, color: option.value }" />
        </label>
      </div>
      <p v-if="errors?.color" class="text-sm font-medium text-destructive">
        {{ errors.color }}
      </p>
    </fieldset>
    <div v-if="canConfidential" class="grid gap-1">
      <label class="flex cursor-pointer items-start gap-2 text-sm text-foreground">
        <input v-model="model.confidential" type="checkbox" name="confidential" class="mt-0.5 size-4 accent-primary" :aria-describedby="`${idPrefix}-confidential-hint`">
        <span class="flex items-center gap-1.5 font-medium"><Lock class="size-3.5" aria-hidden="true" />{{ t('tags.fields.confidential') }}</span>
      </label>
      <p :id="`${idPrefix}-confidential-hint`" class="pl-6 text-sm text-muted-foreground">
        {{ t('tags.fields.confidentialHint') }}
      </p>
    </div>
  </div>
</template>
