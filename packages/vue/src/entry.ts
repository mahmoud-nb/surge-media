/**
 * Entrée du build (vite.config.ts) : le module publié, plus la feuille de style facultative extraite dans
 * `dist/style.css` (jamais importée par le module : l'application choisit de l'importer). Le thème est
 * celui de `@surge-media/client` (construit avant), repris tel quel : `@surge-media/vue/style.css` reste
 * disponible.
 */
import '@surge-media/client/style.css'

export * from './index'
