<script setup lang="ts">
/**
 * Politique de confidentialité de la démo publique : responsable, données traitées (journaux du serveur,
 * cookies, contenus effacés à chaque remise à zéro, comptage des connexions), destinataires, droits.
 * 404 hors démo ou sans éditeur.
 */
const { t } = useI18n()
const { demo, interval } = await useDemoLegal()
const legal = computed(() => demo.value.legal)

useSeoMeta({ title: () => t('legal.privacy.title'), robots: 'noindex, nofollow' })
</script>

<template>
  <AppLegalPage :title="t('legal.privacy.title')" :description="t('legal.privacy.description')">
    <AppLegalSection :title="t('legal.privacy.controller.title')">
      <i18n-t keypath="legal.privacy.controller.text" scope="global" tag="p">
        <template #publisher>
          {{ legal.publisherName }}
        </template>
        <template #email>
          <AppLegalEmail :address="legal.email" />
        </template>
      </i18n-t>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.privacy.data.title')">
      <ul class="grid list-disc gap-2 pl-5">
        <li>{{ t('legal.privacy.data.logs', { days: legal.logRetentionDays }, legal.logRetentionDays) }}</li>
        <li>{{ t('legal.privacy.data.cookies') }}</li>
        <li>{{ t('legal.privacy.data.content', { interval }) }}</li>
        <li>{{ t('legal.privacy.data.visits') }}</li>
      </ul>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.privacy.recipients.title')">
      <p>{{ t('legal.privacy.recipients.text', { host: legal.hostName || t('legal.privacy.recipients.unknownHost') }) }}</p>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.privacy.rights.title')">
      <i18n-t keypath="legal.privacy.rights.text" scope="global" tag="p">
        <template #email>
          <AppLegalEmail :address="legal.email" />
        </template>
      </i18n-t>
    </AppLegalSection>
  </AppLegalPage>
</template>
