<script setup lang="ts">
/**
 * Lien d'invitation ou de réinitialisation à transmettre à l'utilisateur. Le jeton n'est
 * stocké qu'en empreinte : ce lien n'est affiché qu'une fois. À son apparition, le focus
 * est placé sur le titre pour que les lecteurs d'écran l'annoncent.
 */
const props = defineProps<{
  /** Chemin renvoyé par l'API (`/password/<jeton>`). */
  path: string
  purpose: 'INVITATION' | 'RESET'
  expiresAt: string | Date
  email: string
}>()

const { t, locale } = useI18n()
const titleId = useId()
const title = useTemplateRef<HTMLHeadingElement>('title')

const url = computed(() => new URL(props.path, useRequestURL().origin).toString())
const kind = computed(() => (props.purpose === 'INVITATION' ? 'invitation' : 'reset'))

onMounted(() => title.value?.focus())
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

    <UiCopyField :label="t('users.link.label')" :value="url" :copy-label="t('users.link.copy')" />

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
