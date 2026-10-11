<script setup lang="ts">
/**
 * Référence interactive de l'API (Scalar), rendue côté navigateur et chargée à la demande
 * (<LazyAdminApiReference>) : la bibliothèque et ses styles ne pèsent que sur /admin/api.
 * Embarquée dans l'application (aucun script tiers chargé depuis un CDN) ; agent IA, télémétrie,
 * outils de développement et mémorisation de l'authentification désactivés. Langue et thème suivent
 * l'administration ; un changement de langue, de thème ou d'identifiant recrée le composant (Scalar
 * ne relit pas ces réglages à chaud).
 */
import { ApiReference } from '@scalar/api-reference'
import '@scalar/api-reference/style.css'
import '~/assets/css/scalar.css'

type Configuration = NonNullable<InstanceType<typeof ApiReference>['$props']['configuration']>

const props = defineProps<{
  /** Spécification OpenAPI (déjà traduite et enrichie des données réelles). */
  document: Record<string, unknown>
  servers: { url: string, description?: string }[]
  /** Identifiant injecté dans l'en-tête Authorization des requêtes d'essai (null : aucun). */
  token: string | null
}>()

const { t, locale } = useI18n()
const colorMode = useColorMode()
const mode = computed(() => (colorMode.value === 'dark' ? 'dark' : 'light'))

// Recréation du composant quand l'identifiant change (clé de rendu sans la valeur du jeton).
const generation = ref(0)
watch(() => props.token, () => generation.value++)

// Barre latérale de Scalar seulement à partir de xl : en dessous, à côté de celle de
// l'administration, elle ne laisserait au contenu qu'une colonne illisible (recherche ⌘K/Ctrl+K).
const wideQuery = window.matchMedia('(min-width: 80rem)')
const wide = ref(wideQuery.matches)
const onWideChange = (event: MediaQueryListEvent) => (wide.value = event.matches)
wideQuery.addEventListener('change', onWideChange)

const configuration = computed(() => ({
  content: props.document,
  servers: props.servers,
  authentication: {
    preferredSecurityScheme: 'bearerAuth',
    securitySchemes: { bearerAuth: { token: props.token ?? '' } },
  },
  localization: { locale: locale.value },
  theme: 'none',
  forceDarkModeState: mode.value,
  hideDarkModeToggle: true,
  withDefaultFonts: false,
  layout: 'modern',
  showSidebar: wide.value,
  defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
  documentDownloadType: 'json',
  orderSchemaPropertiesBy: 'preserve',
  persistAuth: false,
  telemetry: false,
  showDeveloperTools: 'never',
  agent: { disabled: true },
  mcp: { disabled: true },
}) as Configuration)

/**
 * Correctif d'accessibilité (Scalar 1.72) : chaque exemple de code est une région nommée « Code
 * sample » (en anglais, nom répété), donc un repère de page dupliqué. Ce sont des groupes : rôle
 * `group`, libellé traduit. Scalar rend ces blocs au fil du défilement, y compris dans sa fenêtre
 * de requêtes (hors du composant) : observation de <body> tant que la page est affichée.
 */
const CODE_SAMPLE = '.scalar-app [role="region"][aria-label="Code sample"]'
function relabelCodeSamples(root: Element) {
  for (const element of [...(root.matches(CODE_SAMPLE) ? [root] : []), ...root.querySelectorAll(CODE_SAMPLE)]) {
    element.setAttribute('role', 'group')
    element.setAttribute('aria-label', t('apiDocs.reference.codeSample'))
  }
}
const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) if (node instanceof Element) relabelCodeSamples(node)
  }
})
onMounted(() => {
  relabelCodeSamples(document.body)
  observer.observe(document.body, { childList: true, subtree: true })
})

onBeforeUnmount(() => {
  observer.disconnect()
  wideQuery.removeEventListener('change', onWideChange)
  // Scalar laisse ses classes de thème sur <body> : on les retire en quittant la page.
  document.body.classList.remove('light-mode', 'dark-mode')
})
</script>

<template>
  <div class="surge-api-reference">
    <ApiReference :key="`${locale}:${mode}:${wide}:${generation}`" :configuration="configuration" />
  </div>
</template>
