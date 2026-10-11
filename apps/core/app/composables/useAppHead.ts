/**
 * En-tête commun du document : attributs lang/dir de <html> synchronisés avec la
 * langue active (WCAG 3.1.1) et modèle de titre « Page · surgeMedia ».
 * Appelé par app.vue ET error.vue (qui remplace app.vue lors d'une erreur).
 */
export function useAppHead(): void {
  const { t } = useI18n()
  const localeHead = useLocaleHead()

  useHead(computed(() => ({
    htmlAttrs: {
      lang: localeHead.value.htmlAttrs?.lang,
      dir: localeHead.value.htmlAttrs?.dir,
    },
    titleTemplate: (title?: string) => (title ? `${title} · ${t('app.name')}` : t('app.name')),
  })))
}
