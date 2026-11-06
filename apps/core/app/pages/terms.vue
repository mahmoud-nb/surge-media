<script setup lang="ts">
/**
 * Conditions de la démo publique : objet, remise à zéro, espace partagé, contenus interdits, signalement et
 * retrait, responsabilité, contact. 404 hors démo ou sans éditeur (NUXT_DEMO_TERMS_URL peut pointer ailleurs).
 */
const { t } = useI18n()
const { demo, interval, reportEmail } = await useDemoLegal()
const legal = computed(() => demo.value.legal)

useSeoMeta({ title: () => t('legal.terms.title'), robots: 'noindex, nofollow' })

const FORBIDDEN = ['personal', 'illegal', 'malware', 'hosting'] as const
</script>

<template>
  <AppLegalPage :title="t('legal.terms.title')" :description="t('legal.terms.description')">
    <AppLegalSection :title="t('legal.terms.purpose.title')">
      <p>{{ t('legal.terms.purpose.text') }}</p>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.terms.reset.title')">
      <p>{{ t('legal.terms.reset.text', { interval }) }}</p>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.terms.sharing.title')">
      <p>{{ t('legal.terms.sharing.text') }}</p>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.terms.forbidden.title')">
      <p>{{ t('legal.terms.forbidden.intro') }}</p>
      <ul class="grid list-disc gap-2 pl-5">
        <li v-for="item in FORBIDDEN" :key="item">
          {{ t(`legal.terms.forbidden.items.${item}`) }}
        </li>
      </ul>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.terms.report.title')">
      <i18n-t keypath="legal.terms.report.text" scope="global" tag="p">
        <template #address>
          <AppLegalEmail :address="reportEmail" />
        </template>
      </i18n-t>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.terms.liability.title')">
      <p>{{ t('legal.terms.liability.text') }}</p>
    </AppLegalSection>

    <AppLegalSection :title="t('legal.terms.contact.title')">
      <i18n-t keypath="legal.terms.contact.text" scope="global" tag="p">
        <template #email>
          <AppLegalEmail :address="legal.email" />
        </template>
      </i18n-t>
    </AppLegalSection>
  </AppLegalPage>
</template>
