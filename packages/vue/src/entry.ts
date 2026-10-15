/**
 * Entrée du build (vite.config.ts) : le module publié, plus la feuille de style facultative extraite dans
 * `dist/style.css` (jamais importée par le module : l'application choisit de l'importer).
 */
import './styles/index.css'

export * from './index'
