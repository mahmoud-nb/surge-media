/**
 * En-tête commun du document : attributs lang/dir de <html> synchronisés avec la
 * langue active (WCAG 3.1.1), modèle de titre « Page · SurgeMedia » et icône (celle du site public :
 * public/favicon.svg, clair et sombre ; favicon.ico pour les navigateurs et outils qui ne lisent que lui).
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
    link: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
    ],
  })))
}
