<script setup lang="ts">
/**
 * Mentions légales de la démo publique : éditeur, directeur de la publication, hébergeur, signalement d'un
 * contenu, logiciel. Valeurs NUXT_DEMO_LEGAL_* (jamais dans le dépôt) ; 404 hors démo ou sans éditeur.
 */
const { t } = useI18n()
const { demo, reportEmail } = await useDemoLegal()
const legal = computed(() => demo.value.legal)

useSeoMeta({ title: () => t('legal.notice.title'), robots: 'noindex, nofollow' })

const telephone = (value: string) => (value ? `tel:${value.replace(/[^\d+]/g, '')}` : undefined)

const publisher = computed(() => [
  { label: t('legal.notice.publisher.name'), value: legal.value.publisherName },
  ...(legal.value.tradeName ? [{ label: t('legal.notice.publisher.tradeName'), value: legal.value.tradeName }] : []),
  { label: t('legal.notice.publisher.registration'), value: legal.value.registration },
  { label: t('legal.notice.address'), value: legal.value.address },
  { label: t('legal.notice.email'), value: legal.value.email, href: legal.value.email ? `mailto:${legal.value.email}` : undefined },
  ...(legal.value.phone ? [{ label: t('legal.notice.phone'), value: legal.value.phone, href: telephone(legal.value.phone) }] : []),
])

const host = computed(() => [
  { label: t('legal.notice.host.name'), value: legal.value.hostName },
  { label: t('legal.notice.address'), value: legal.value.hostAddress },
  ...(legal.value.hostPhone ? [{ label: t('legal.notice.phone'), value: legal.value.hostPhone, href: telephone(legal.value.hostPhone) }] : []),
])
</script>

<template>
  <AppLegalPage :title="t('legal.notice.title')" :description="t('legal.notice.description')">
    <AppLegalSection :title="t('legal.notice.publisher.title')">
      <AppLegalFacts :rows="publisher" />
    </AppLegalSection>

    <AppLegalSection :title="t('legal.notice.director.title')">
      <p>{{ legal.director }}</p>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.notice.host.title')">
      <AppLegalFacts :rows="host" />
    </AppLegalSection>

    <AppLegalSection :title="t('legal.notice.report.title')">
      <i18n-t keypath="legal.notice.report.text" scope="global" tag="p">
        <template #address>
          <AppLegalEmail :address="reportEmail" />
        </template>
      </i18n-t>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.notice.software.title')">
      <p>{{ t('legal.notice.software.text') }}</p>
    </AppLegalSection>
  </AppLegalPage>
</template>
