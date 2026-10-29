<script setup lang="ts">
/**
 * Codes de secours de la double authentification, montrés une seule fois (activation, régénération) :
 * copier, télécharger en .txt, puis confirmer les avoir enregistrés avant de continuer.
 */
import { Download } from '@lucide/vue'

const props = defineProps<{
  codes: string[]
  /** Adresse du compte, rappelée en tête du fichier téléchargé. */
  email: string
}>()
const emit = defineEmits<{ continue: [] }>()

const { t } = useI18n()
const confirmId = useId()
const saved = ref(false)

const text = computed(() => props.codes.join('\n'))

function download() {
  const content = `${t('mfa.codes.fileHeader', { email: props.email })}\n\n${text.value}\n`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = t('mfa.codes.fileName')
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="grid gap-4">
    <p class="text-sm text-muted-foreground">
      {{ t('mfa.codes.description') }}
    </p>
    <ul :aria-label="t('mfa.codes.listLabel')" class="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-border bg-muted p-4 font-mono text-sm text-foreground">
      <li v-for="code in codes" :key="code" translate="no">
        {{ code }}
      </li>
    </ul>
    <div class="flex flex-wrap gap-2">
      <UiCopyButton :value="text" :label="t('mfa.codes.copy')" />
      <UiButton variant="outline" size="sm" @click="download">
        <Download aria-hidden="true" />
        {{ t('mfa.codes.download') }}
      </UiButton>
    </div>
    <label :for="confirmId" class="flex cursor-pointer items-start gap-2.5 text-sm font-medium text-foreground">
      <input :id="confirmId" v-model="saved" type="checkbox" class="mt-0.5 size-4 shrink-0 accent-primary">
      {{ t('mfa.codes.confirm') }}
    </label>
    <UiButton :disabled="!saved" class="w-full sm:w-auto sm:justify-self-start" @click="emit('continue')">
      {{ t('mfa.codes.continue') }}
    </UiButton>
  </div>
</template>
