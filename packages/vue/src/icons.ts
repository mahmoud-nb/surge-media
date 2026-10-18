/**
 * Icônes en SVG en ligne (aucune dépendance), décoratives (`aria-hidden`) : le sens est toujours porté par
 * un texte. Tracés et attributs fournis par `@surge-media/client` (`ICONS`, repris de Lucide, licence ISC) :
 * seul le rendu est propre à Vue.
 */
import { ICONS, type IconName, iconSvgAttributes } from '@surge-media/client'
import { type FunctionalComponent, h } from 'vue'

export type IconComponent = FunctionalComponent<{ size?: number }>

function icon(name: IconName): IconComponent {
  const component: IconComponent = props =>
    h('svg', iconSvgAttributes(name, props.size), ICONS[name].map(([tag, attributes]) => h(tag, attributes)))
  component.props = ['size']
  component.displayName = `SmIcon_${name}`
  return component
}

/** Composant de chaque icône, par nom (`PROCESSING_ICONS`, `kindIcon`… du client). */
export const ICON_COMPONENTS = Object.fromEntries(Object.keys(ICONS).map(name => [name, icon(name as IconName)])) as Record<IconName, IconComponent>

export const IconImage = ICON_COMPONENTS.image
export const IconFilm = ICON_COMPONENTS.film
export const IconFile = ICON_COMPONENTS.file
export const IconPlay = ICON_COMPONENTS.play
export const IconPause = ICON_COMPONENTS.pause
export const IconHourglass = ICON_COMPONENTS.hourglass
export const IconCog = ICON_COMPONENTS.cog
export const IconCircleCheck = ICON_COMPONENTS['circle-check']
export const IconTriangleAlert = ICON_COMPONENTS['triangle-alert']
export const IconDownload = ICON_COMPONENTS.download
export const IconUpload = ICON_COMPONENTS.upload
export const IconX = ICON_COMPONENTS.x
export const IconRotateCcw = ICON_COMPONENTS['rotate-ccw']
export const IconTrash = ICON_COMPONENTS.trash
