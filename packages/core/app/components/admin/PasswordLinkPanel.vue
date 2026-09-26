<script setup lang="ts">
/**
 * Lien d'invitation ou de réinitialisation à transmettre à l'utilisateur. Le jeton n'est
 * stocké qu'en empreinte : ce lien n'est affiché qu'une fois. À son apparition, le focus
 * est placé sur le titre pour que les lecteurs d'écran l'annoncent.
 */
import { Check, Copy } from '@lucide/vue'

const props = defineProps<{
  /** Chemin renvoyé par l'API (`/password/<jeton>`). */
  path: string
  purpose: 'INVITATION' | 'RESET'
  expiresAt: string | Date
  email: string
}>()

const { t, locale } = useI18n()
const inputId = useId()
const titleId = useId()
const title = useTemplateRef<HTMLHeadingElement>('title')
const copied = ref(false)

const url = computed(() => new URL(props.path, useRequestURL().origin).toString())
const kind = computed(() => (props.purpose === 'INVITATION' ? 'invitation' : 'reset'))

onMounted(() => title.value?.focus())

async function copy() {
  try {
    await navigator.clipboard.writeText(url.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 5000)
  }
  catch {
    // Presse-papiers indisponible (HTTP, permissions) : sélection pour une copie manuelle.
    const input = document.getElementById(inputId)
    if (input instanceof HTMLInputElement) {
      input.focus()
      input.select()
    }
  }
}
</script>

<template>
  <section :aria-labelledby="titleId" class="grid gap-4 rounded-xl border border-primary/40 bg-primary-soft p-5">
    <div class="grid gap-1">
      <h2 :id="titleId" ref="title" tabindex="-1" class="font-semibold text-foreground">
        {{ t(`users.link.${kind}.title`) }}
      </h2>
      <p class="text-sm text-foreground">
        {{ t(`users.link.${kind}.description`, { email }) }}
      </p>
    </div>

    <div class="grid gap-1.5">
      <label :for="inputId" class="text-sm font-medium text-foreground">{{ t('users.link.label') }}</label>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UiInput :id="inputId" :model-value="url" readonly class="font-mono text-xs sm:text-xs" @focus="($event.target as HTMLInputElement).select()" />
        <UiButton variant="outline" class="shrink-0" @click="copy">
          <Check v-if="copied" aria-hidden="true" />
          <Copy v-else aria-hidden="true" />
          {{ t('users.link.copy') }}
        </UiButton>
      </div>
      <p class="min-h-5 text-sm font-medium text-success" role="status">
        {{ copied ? t('users.link.copied') : '' }}
      </p>
    </div>

    <p class="text-sm text-foreground">
      <!-- Composant inséré dans la phrase traduite : l'ordre des mots reste propre à chaque langue. -->
      <i18n-t keypath="users.link.expires" tag="span" scope="global">
        <template #date>
          <NuxtTime :datetime="expiresAt" :locale="locale" date-style="long" time-style="short" class="font-medium" />
        </template>
      </i18n-t>
      {{ t('users.link.once') }}
    </p>
  </section>
</template>
