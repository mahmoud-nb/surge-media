<script setup lang="ts">
/**
 * Lien d'invitation ou de réinitialisation à transmettre à l'utilisateur. Le jeton n'est
 * stocké qu'en empreinte : ce lien n'est affiché qu'une fois. À son apparition, le focus
 * est placé sur le titre pour que les lecteurs d'écran l'annoncent.
 * « Envoyer par e-mail » (si l'envoi SMTP est configuré) : le serveur vérifie que le lien est
 * encore celui du compte et l'envoie à son adresse, dans la langue de l'interface.
 */
import { Mail } from '@lucide/vue'

const props = defineProps<{
  /** Chemin renvoyé par l'API (`/password/<jeton>`). */
  path: string
  purpose: 'INVITATION' | 'RESET'
  expiresAt: string | Date
  email: string
  /** Compte concerné : nécessaire à l'envoi par e-mail. */
  userId?: string
}>()

const { t, locale } = useI18n()
const { $api } = useNuxtApp()
const titleId = useId()
const title = useTemplateRef<HTMLHeadingElement>('title')

const url = computed(() => new URL(props.path, useRequestURL().origin).toString())
const kind = computed(() => (props.purpose === 'INVITATION' ? 'invitation' : 'reset'))

// Bouton proposé seulement si le serveur sait envoyer des e-mails (NUXT_SMTP_HOST, NUXT_SMTP_FROM).
const { data: mail } = useApiFetch('/api/admin/config/mail', { lazy: true })
const canEmail = computed(() => Boolean(props.userId && mail.value?.enabled))

const sending = ref(false)
const sent = ref<string | null>(null)
const sendError = ref<string | null>(null)

function sendErrorMessage(error: unknown): string {
  const { code, status, retryAfter } = apiError(error)
  if (status === 429) return t('users.link.mail.tooMany', { minutes: Math.ceil((retryAfter ?? 60) / 60) })
  if (code === 'TOKEN_INVALID') return t('users.link.mail.invalid')
  if (code === 'MAIL_NOT_CONFIGURED') return t('users.link.mail.notConfigured')
  if (code === 'MAIL_FAILED') return t('users.link.mail.failed')
  if (code === 'INVITATION_ACCEPTED') return t('users.errors.invitationAccepted')
  return t('common.unexpectedError')
}

async function sendByEmail() {
  if (!props.userId || sending.value) return
  sent.value = null
  sendError.value = null
  sending.value = true
  try {
    const { to } = await $api(`/api/admin/users/${props.userId}/password-link/email`, {
      method: 'POST',
      body: {
        token: props.path.split('/').pop() ?? '',
        locale: locale.value,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    })
    sent.value = to
  }
  catch (error) {
    sendError.value = sendErrorMessage(error)
  }
  finally {
    sending.value = false
  }
}

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

    <UiCopyField :label="t('users.link.label')" :value="url" :copy-label="t('users.link.copy')">
      <template v-if="canEmail" #actions>
        <UiButton variant="outline" class="shrink-0" :loading="sending" @click="sendByEmail">
          <Mail aria-hidden="true" />
          {{ t('users.link.mail.send') }}
        </UiButton>
      </template>
    </UiCopyField>

    <template v-if="canEmail">
      <p class="-mt-4 min-h-5 text-sm font-medium text-success" role="status">
        {{ sent ? t('users.link.mail.sent', { email: sent }) : '' }}
      </p>
      <UiAlert v-if="sendError" variant="error" live="assertive" class="-mt-2">
        {{ sendError }}
      </UiAlert>
    </template>

    <p class="text-sm text-foreground">
      <!-- Composant inséré dans la phrase traduite : l'ordre des mots reste propre à chaque langue. -->
      <i18n-t keypath="users.link.expires" tag="span" scope="global">
        <template #date>
          <NuxtTime :datetime="expiresAt" :locale="locale" date-style="long" time-style="short" class="font-medium" />
        </template>
      </i18n-t>
      {{ canEmail ? t('users.link.onceMail') : t('users.link.once') }}
    </p>
  </section>
</template>
