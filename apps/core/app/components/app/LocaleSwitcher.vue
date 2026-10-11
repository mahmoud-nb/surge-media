<script setup lang="ts">
/**
 * Choix de la langue : bouton de divulgation (aria-expanded) ouvrant la liste des
 * langues disponibles, affichées dans leur propre langue (attribut lang).
 * Échap ferme la liste et rend le focus au bouton. La liste s'étend automatiquement
 * aux langues déclarées dans nuxt.config.ts.
 */
import { Check, ChevronDown, Languages } from '@lucide/vue'

const props = withDefaults(defineProps<{
  /** Ouverture vers le haut (bas de barre latérale) ou vers le bas (en-tête). */
  placement?: 'top' | 'bottom'
}>(), {
  placement: 'bottom',
})

const { t, locale, locales, setLocale } = useI18n()
const open = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const toggle = useTemplateRef<HTMLButtonElement>('toggle')
const listId = useId()

const options = computed(() => locales.value.map(item => ({ code: item.code, name: item.name ?? item.code })))
const current = computed(() => options.value.find(item => item.code === locale.value))

function close(restoreFocus = false) {
  if (!open.value) return
  open.value = false
  if (restoreFocus) toggle.value?.focus()
}

function onFocusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) close()
}

async function select(code: typeof locale.value) {
  close(true)
  if (code !== locale.value) await setLocale(code)
}
</script>

<template>
  <div ref="root" class="relative" @keydown.esc="close(true)" @focusout="onFocusOut">
    <button
      ref="toggle"
      type="button"
      class="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      :aria-expanded="open"
      :aria-controls="listId"
      @click="open = !open"
    >
      <Languages class="size-4 text-muted-foreground" aria-hidden="true" />
      <!-- Nom accessible complet (« Langue : Français ») ; la ponctuation dépend de la langue. -->
      <span class="sr-only">{{ t('locale.current', { name: current?.name ?? '' }) }}</span>
      <span :lang="current?.code" aria-hidden="true">{{ current?.name }}</span>
      <ChevronDown :class="cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')" aria-hidden="true" />
    </button>
    <ul
      v-show="open"
      :id="listId"
      :class="cn(
        'absolute z-40 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-lg',
        props.placement === 'top' ? 'bottom-full left-0 mb-2' : 'top-full right-0 mt-2',
      )"
    >
      <li v-for="option in options" :key="option.code">
        <button
          type="button"
          :lang="option.code"
          :aria-current="option.code === locale ? 'true' : undefined"
          class="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted aria-[current=true]:font-semibold"
          @click="select(option.code)"
        >
          {{ option.name }}
          <Check v-if="option.code === locale" class="size-4 text-primary" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>
