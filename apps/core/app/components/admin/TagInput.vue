<script setup lang="ts">
/**
 * Choix d'étiquettes à saisie semi-automatique (architecture-tags.md, TG12) — filtre de la médiathèque,
 * fiche d'un média, affectation en lot :
 *
 *   <AdminTagInput v-model="slugs" :options="tags" by="slug" :label="t('…')" />
 *
 * Motif « combobox » de l'ARIA APG : champ `role=combobox` (`aria-expanded`, `aria-controls`,
 * `aria-activedescendant`), liste `role=listbox` d'options groupées (globales, du projet) ; flèches
 * haut / bas, Entrée choisit, Échap ferme puis efface la saisie. Les étiquettes choisies sont des puces
 * avec chacune un bouton « Retirer » (jamais de suppression silencieuse par Retour arrière). Les
 * suggestions sont filtrées dans le navigateur (sans casse ni accents, nom et slug) : aucune requête par
 * frappe. Leur nombre est annoncé une fois la saisie posée, comme chaque ajout ou retrait.
 */
import { Check, Plus, X } from '@lucide/vue'
import type { TagOption } from '~/composables/useTagLabels'
import { tagSearchText } from '~/composables/useTagLabels'

const props = withDefaults(defineProps<{
  /** Étiquettes proposées (globales puis du projet). */
  options: readonly TagOption[]
  label: string
  /** Valeur gardée dans le modèle : identifiant (fiche, lot) ou slug (filtre, URL). */
  by?: 'id' | 'slug'
  hint?: string
  error?: string
  id?: string
  disabled?: boolean
}>(), { by: 'id' })

const model = defineModel<string[]>({ default: () => [] })

const { t } = useI18n()
const generatedId = useId()
const inputId = computed(() => props.id ?? generatedId)
const listboxId = `${generatedId}-listbox`
const hintId = `${generatedId}-hint`
const errorId = `${generatedId}-error`
const input = useTemplateRef<HTMLInputElement>('input')

const query = ref('')
const open = ref(false)
const activeIndex = ref(-1)
const announcement = ref('')

const valueOf = (tag: TagOption) => (props.by === 'slug' ? tag.slug : tag.id)
const byValue = computed(() => new Map(props.options.map(tag => [valueOf(tag), tag])))
/** Étiquettes choisies connues (une valeur inconnue — étiquette supprimée — n'est pas affichée). */
const selected = computed(() => model.value.map(value => byValue.value.get(value)).filter((tag): tag is TagOption => Boolean(tag)))

const suggestions = computed(() => {
  const chosen = new Set(model.value)
  const term = normalizeSearchText(query.value)
  return props.options.filter(tag => !chosen.has(valueOf(tag)) && (!term || tagSearchText(tag).includes(term)))
})
const groups = computed(() => (['global', 'project'] as const)
  .map(level => ({ level, items: suggestions.value.filter(tag => tag.level === level) }))
  .filter(group => group.items.length > 0))
/** Ordre de navigation au clavier : celui de l'affichage (globales puis projet). */
const ordered = computed(() => groups.value.flatMap(group => group.items))
const activeId = computed(() => (open.value && ordered.value[activeIndex.value] ? optionId(ordered.value[activeIndex.value]!) : undefined))

const describedBy = computed(() => [props.hint && hintId, props.error && errorId].filter(Boolean).join(' ') || undefined)

/** Nom accessible d'une option : nom, confidentialité, identifiant (le badge et le slug sont collés à l'écran). */
function optionLabel(tag: TagOption) {
  return [tag.confidential ? `${tag.name} ${t('tags.confidentialSuffix')}` : tag.name, tag.slug].join(', ')
}

function optionId(tag: TagOption) {
  return `${generatedId}-option-${tag.id}`
}

// Nombre de suggestions annoncé quand la saisie se pose (pas à chaque frappe).
let announceTimer: ReturnType<typeof setTimeout> | undefined
watch([query, open], () => {
  clearTimeout(announceTimer)
  if (!open.value) return
  announceTimer = setTimeout(() => {
    announcement.value = t('tags.input.suggestions', { count: ordered.value.length }, ordered.value.length)
  }, 600)
})
onBeforeUnmount(() => clearTimeout(announceTimer))

function openList() {
  if (props.disabled) return
  open.value = true
  if (activeIndex.value >= ordered.value.length) activeIndex.value = ordered.value.length - 1
}

function close() {
  open.value = false
  activeIndex.value = -1
}

function move(step: number) {
  if (!open.value) {
    openList()
    activeIndex.value = step > 0 ? 0 : ordered.value.length - 1
    return
  }
  const count = ordered.value.length
  if (count === 0) return
  activeIndex.value = (activeIndex.value + step + count) % count
}

function choose(tag: TagOption) {
  model.value = [...model.value, valueOf(tag)]
  announcement.value = t('tags.input.added', { name: tag.name })
  query.value = ''
  activeIndex.value = Math.min(activeIndex.value, ordered.value.length - 1)
  input.value?.focus()
}

function remove(tag: TagOption) {
  model.value = model.value.filter(value => value !== valueOf(tag))
  announcement.value = t('tags.input.removed', { name: tag.name })
  input.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      move(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      move(-1)
      break
    case 'Enter': {
      const tag = open.value ? ordered.value[activeIndex.value] : undefined
      // Entrée sans suggestion active : laissée au formulaire (filtres : « Filtrer »).
      if (tag) {
        event.preventDefault()
        choose(tag)
      }
      break
    }
    case 'Escape':
      if (open.value) {
        event.preventDefault()
        close()
      }
      else if (query.value) {
        event.preventDefault()
        query.value = ''
      }
      break
    case 'Tab':
      close()
      break
  }
}

function onInput() {
  openList()
  activeIndex.value = ordered.value.length > 0 ? 0 : -1
}

/** Le focus quitte le composant (ni le champ ni la liste) : la liste se ferme. */
function onFocusout(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (!next || !(event.currentTarget as HTMLElement).contains(next)) close()
}
</script>

<template>
  <div class="grid gap-1.5" @focusout="onFocusout">
    <label :for="inputId" class="text-sm font-medium text-foreground">{{ label }}</label>

    <ul v-if="selected.length > 0" class="flex flex-wrap gap-1.5" :aria-label="t('tags.input.selected', { label, count: selected.length }, selected.length)">
      <li v-for="tag in selected" :key="tag.id" class="flex max-w-full items-center gap-0.5">
        <AdminTagBadge :tag="tag" />
        <button
          type="button"
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
          :disabled="disabled"
          :aria-label="t('tags.input.remove', { name: tag.name })"
          @click="remove(tag)"
        >
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <div class="relative">
      <input
        :id="inputId"
        ref="input"
        v-model="query"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="listboxId"
        :aria-activedescendant="activeId"
        :aria-describedby="describedBy"
        :aria-invalid="Boolean(error) || undefined"
        :disabled="disabled"
        :placeholder="t('tags.input.placeholder')"
        :class="cn(
          'block h-10 w-full min-w-0 rounded-lg border border-input bg-surface px-3 text-base text-foreground shadow-xs sm:text-sm',
          'placeholder:text-muted-foreground focus-visible:border-ring',
          'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-2 aria-invalid:border-destructive',
        )"
        @input="onInput"
        @keydown="onKeydown"
        @click="openList"
      >
      <!-- La liste reste dans le DOM (aria-controls) ; elle est seulement masquée quand elle est fermée. -->
      <div
        :id="listboxId"
        role="listbox"
        :aria-label="t('tags.input.listLabel', { label })"
        :hidden="!open"
        class="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-input bg-surface p-1 shadow-lg"
      >
        <div v-for="group in groups" :key="group.level" role="group" :aria-labelledby="`${generatedId}-group-${group.level}`">
          <div :id="`${generatedId}-group-${group.level}`" role="presentation" class="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
            {{ t(`tags.levels.${group.level}`) }}
          </div>
          <div
            v-for="tag in group.items"
            :id="optionId(tag)"
            :key="tag.id"
            role="option"
            aria-selected="false"
            :aria-label="optionLabel(tag)"
            :class="cn(
              'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground',
              activeId === optionId(tag) ? 'bg-primary-soft outline-2 outline-ring' : 'hover:bg-muted',
            )"
            @mousedown.prevent
            @click="choose(tag)"
          >
            <Plus class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <AdminTagBadge :tag="tag" />
            <span class="truncate text-xs text-muted-foreground">{{ tag.slug }}</span>
          </div>
        </div>
        <p v-if="ordered.length === 0" class="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
          <Check v-if="options.length > 0 && !query" class="size-4" aria-hidden="true" />
          {{ options.length === 0 ? t('tags.input.noTags') : query ? t('tags.input.noMatch') : t('tags.input.allChosen') }}
        </p>
      </div>
    </div>

    <p v-if="hint" :id="hintId" class="text-sm text-muted-foreground">
      {{ hint }}
    </p>
    <p v-if="error" :id="errorId" class="text-sm font-medium text-destructive">
      {{ error }}
    </p>
    <p class="sr-only" role="status" aria-live="polite">
      {{ announcement }}
    </p>
  </div>
</template>
