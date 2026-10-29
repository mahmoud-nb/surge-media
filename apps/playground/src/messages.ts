import { computed, type Ref } from 'vue'

/** Textes du bac à sable (français par défaut, anglais), comme ceux des composants. */
const MESSAGES = {
  fr: {
    title: 'Bac à sable surgeMedia',
    intro: 'Composants de @surge-media/vue branchés sur le core local.',
    language: 'Langue',
    theme: 'Thème',
    themes: { system: 'Système', light: 'Clair', dark: 'Sombre' },
    nav: 'Pages du bac à sable',
    pages: { images: 'Images', videos: 'Vidéos', private: 'Média privé', public: 'Clé publique', fallbacks: 'Replis', upload: 'Envoi' },
    project: 'Projet : politique « {policy} », formats {formats}, {max} px au plus.',
    projectPending: 'Lecture du projet…',
    missingConfig: 'Configuration manquante : copiez apps/playground/.env.example en .env.local et complétez-le.',
    loading: 'Chargement des médias…',
    empty: 'Aucun média de ce genre dans le projet.',
    media: 'Média',
    demos: {
      fluid: 'Image fluide (srcset en largeurs)',
      fixed: 'Taille fixe de 320 px (densités 1x, 2x, 3x)',
      aspect: 'Rapport 16/9 recadré par le serveur sur le point d\'intérêt',
      cover: 'Cadre carré rempli, recadré par le navigateur',
      picture: '<picture> : AVIF, WebP, JPEG ; carré sous 640 px',
      preset: 'Préréglage « preview »',
      thumbnails: 'Vignettes',
      video: 'Lecteur natif (sources, affiche, sous-titres)',
      lazy: 'Chargement différé',
      ambient: 'Vidéo d\'ambiance (muette, en boucle, bouton pause)',
      private: 'Image privée (URL signées, jeton délégué)',
      public: 'Médias publics lus avec la clé publique',
      brokenDerived: 'Dérivé introuvable : repli sur l\'original',
      broken: 'Dérivé et original introuvables : état d\'erreur',
      pending: 'Vidéo en préparation, sans source lisible',
      failed: 'Traitement de la vidéo interrompu',
      upload: 'Envoi direct, visibilité au choix',
      uploadDetails: 'Images avec titre et texte alternatif',
      uploaded: 'Médias envoyés',
    },
    error: 'Erreur : {message}',
  },
  en: {
    title: 'surgeMedia playground',
    intro: '@surge-media/vue components connected to the local core.',
    language: 'Language',
    theme: 'Theme',
    themes: { system: 'System', light: 'Light', dark: 'Dark' },
    nav: 'Playground pages',
    pages: { images: 'Images', videos: 'Videos', private: 'Private media', public: 'Publishable key', fallbacks: 'Fallbacks', upload: 'Upload' },
    project: 'Project: “{policy}” policy, formats {formats}, {max} px at most.',
    projectPending: 'Reading the project…',
    missingConfig: 'Missing configuration: copy apps/playground/.env.example to .env.local and fill it in.',
    loading: 'Loading media…',
    empty: 'No media of this kind in the project.',
    media: 'Media',
    demos: {
      fluid: 'Fluid image (srcset with widths)',
      fixed: 'Fixed size of 320 px (1x, 2x, 3x densities)',
      aspect: '16/9 ratio cropped by the server around the focal point',
      cover: 'Square frame filled, cropped by the browser',
      picture: '<picture>: AVIF, WebP, JPEG; square below 640 px',
      preset: '“preview” preset',
      thumbnails: 'Thumbnails',
      video: 'Native player (sources, poster, captions)',
      lazy: 'Lazy loading',
      ambient: 'Ambient video (muted, looping, pause button)',
      private: 'Private image (signed URLs, delegated token)',
      public: 'Public media read with the publishable key',
      brokenDerived: 'Missing derivative: falls back to the original',
      broken: 'Missing derivative and original: error state',
      pending: 'Video being prepared, no playable source',
      failed: 'Video processing stopped',
      upload: 'Direct upload, visibility to choose',
      uploadDetails: 'Images with title and alternative text',
      uploaded: 'Uploaded media',
    },
    error: 'Error: {message}',
  },
} as const

type Tree = { readonly [key: string]: string | Tree }

export function usePlaygroundText(locale: Ref<string>) {
  const messages = computed<Tree>(() => (locale.value.startsWith('en') ? MESSAGES.en : MESSAGES.fr))
  return (key: string, params: Record<string, string | number> = {}) => {
    let node: string | Tree | undefined = messages.value
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined
    const text = typeof node === 'string' ? node : key
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
  }
}
