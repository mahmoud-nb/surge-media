<script setup lang="ts">
/**
 * Réglages › Licence, « Usage de cette instance » (ancre #usage, liens du tableau de bord) : déclaration de
 * l'usage (évaluation, production Community, production sous licence commerciale), et enregistrement facultatif
 * auprès de Surge Up par un e-mail prérempli que l'administrateur relit et envoie lui-même. Le produit ne vérifie
 * rien et n'envoie rien. Pas de mode sudo : c'est une déclaration. En mode démo : lecture seule, sans
 * enregistrement. Architecture : .claude/architecture-usage.md.
 */
import { ClipboardList, Mail } from '@lucide/vue'
import {
  LICENSE_USAGES,
  LICENSING_EMAIL,
  licenseFeaturesActive,
  licenseRegistrationMailto,
  type LicenseState,
  type LicenseUsage,
} from '#shared/utils/license'

const props = defineProps<{
  state: LicenseState
  instanceId: string
  version: string
  usage: { usage: LicenseUsage, declaredAt: string, stale: boolean } | null
}>()
const emit = defineEmits<{ declared: [] }>()

const { t, locale } = useI18n()
const { $api } = useNuxtApp()
const demo = useDemoInfo()
const titleId = useId()

const choice = ref<LicenseUsage | ''>(props.usage?.usage ?? '')
watch(() => props.usage?.usage, (value) => {
  if (value) choice.value = value
})

const options = computed(() => LICENSE_USAGES.map(value => ({
  value,
  label: t(`settings.license.usage.options.${value}.label`),
  description: t(`settings.license.usage.options.${value}.description`),
})))

/** Une licence active couvre l'instance : pas de rappel, quel que soit l'usage déclaré. */
const licensed = computed(() => licenseFeaturesActive(props.state))
const confirming = computed(() => choice.value !== '' && choice.value === props.usage?.usage)

const status = ref<{ variant: 'success' | 'error', message: string } | null>(null)
const saving = ref(false)
// Un nouveau choix efface le message précédent (« Choisissez un usage », « Usage enregistré »).
watch(choice, () => {
  status.value = null
})

async function save() {
  status.value = null
  if (!choice.value) {
    status.value = { variant: 'error', message: t('settings.license.usage.required') }
    return
  }
  saving.value = true
  try {
    await $api('/api/admin/license/usage', { method: 'PUT', body: { usage: choice.value } })
    status.value = { variant: 'success', message: t(confirming.value ? 'settings.license.usage.confirmed' : 'settings.license.usage.saved') }
    emit('declared')
  }
  catch {
    status.value = { variant: 'error', message: t('settings.license.usage.error') }
  }
  finally {
    saving.value = false
  }
}

const mailto = computed(() => {
  const usage = props.usage ? t(`settings.license.usage.options.${props.usage.usage}.label`) : t('settings.license.register.mail.undeclared')
  return licenseRegistrationMailto(t('settings.license.register.mail.subject'), [
    t('settings.license.register.mail.greeting'),
    '',
    t('settings.license.register.mail.intro'),
    '',
    t('settings.license.register.mail.instance', { id: props.instanceId }),
    t('settings.license.register.mail.version', { version: props.version }),
    t('settings.license.register.mail.usage', { usage }),
    t('settings.license.register.mail.organization'),
    t('settings.license.register.mail.contact'),
  ])
})
</script>

<template>
  <section id="usage" :aria-labelledby="titleId" class="grid scroll-mt-6 gap-4 rounded-xl border border-border bg-surface p-5">
    <h3 :id="titleId" class="flex items-center gap-2 text-lg font-semibold text-foreground">
      <ClipboardList class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {{ t('settings.license.usage.title') }}
    </h3>
    <p class="text-sm text-muted-foreground">
      {{ t('settings.license.usage.intro') }}
    </p>

    <UiRadioCards
      v-model="choice"
      :legend="t('settings.license.usage.legend')"
      :options="options"
      :disabled="Boolean(demo)"
      :hint="demo ? t('demo.readOnly') : undefined"
    />

    <i18n-t
      v-if="usage"
      :keypath="usage.stale ? 'settings.license.usage.declaredStale' : 'settings.license.usage.declaredOn'"
      scope="global"
      tag="p"
      class="text-sm text-muted-foreground"
    >
      <template #date>
        <NuxtTime :datetime="usage.declaredAt" :locale="locale" date-style="long" />
      </template>
    </i18n-t>
    <p v-else class="text-sm text-muted-foreground">
      {{ t('settings.license.usage.undeclared') }}
    </p>

    <UiAlert v-if="choice === 'commercial' && !licensed" variant="info">
      <i18n-t keypath="settings.license.usage.commercialHint" scope="global" tag="span">
        <template #email>
          <a :href="`mailto:${LICENSING_EMAIL}`" class="font-medium text-primary underline-offset-4 hover:underline">{{ LICENSING_EMAIL }}</a>
        </template>
      </i18n-t>
    </UiAlert>

    <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'">
      {{ status.message }}
    </UiAlert>
    <div v-if="!demo">
      <UiButton :loading="saving" @click="save">
        {{ confirming ? t('settings.license.usage.confirm') : t('common.save') }}
      </UiButton>
    </div>

    <!-- Enregistrement facultatif : un e-mail prérempli, envoyé (ou non) par l'administrateur. -->
    <div v-if="!demo" class="grid gap-3 border-t border-border pt-4 text-sm">
      <h4 class="font-medium text-foreground">
        {{ t('settings.license.register.title') }}
      </h4>
      <p class="text-muted-foreground">
        {{ t('settings.license.register.text') }}
      </p>
      <p class="text-muted-foreground">
        {{ t('settings.license.register.privacy') }}
      </p>
      <div>
        <UiButton :to="mailto" external variant="outline" class="h-auto min-h-10 py-2 whitespace-normal">
          <Mail class="size-4 shrink-0" aria-hidden="true" />
          {{ t('settings.license.register.action') }}
        </UiButton>
      </div>
    </div>
  </section>
</template>
