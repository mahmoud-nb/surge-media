/**
 * Icônes en SVG en ligne (aucune dépendance), décoratives (`aria-hidden`) : le sens est toujours porté par
 * un texte. Tracés repris de Lucide (https://lucide.dev), licence ISC :
 *
 *   Copyright (c) 2026 Lucide Icons and Contributors. Permission to use, copy, modify, and/or distribute
 *   this software for any purpose with or without fee is hereby granted, provided that the above copyright
 *   notice and this permission notice appear in all copies.
 */
import { type FunctionalComponent, h } from 'vue'

type IconNode = [tag: 'path' | 'rect' | 'circle', attributes: Record<string, string>][]

function icon(name: string, nodes: IconNode): FunctionalComponent<{ size?: number }> {
  const component: FunctionalComponent<{ size?: number }> = props =>
    h('svg', {
      'xmlns': 'http://www.w3.org/2000/svg',
      'width': props.size ?? 16,
      'height': props.size ?? 16,
      'viewBox': '0 0 24 24',
      'fill': 'none',
      'stroke': 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      'focusable': 'false',
      'class': `sm-icon sm-icon--${name}`,
    }, nodes.map(([tag, attributes]) => h(tag, attributes)))
  component.props = ['size']
  component.displayName = `SmIcon_${name}`
  return component
}

export const IconImage = icon('image', [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2' }],
  ['circle', { cx: '9', cy: '9', r: '2' }],
  ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
])

export const IconFilm = icon('film', [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['path', { d: 'M7 3v18' }],
  ['path', { d: 'M3 7.5h4' }],
  ['path', { d: 'M3 12h18' }],
  ['path', { d: 'M3 16.5h4' }],
  ['path', { d: 'M17 3v18' }],
  ['path', { d: 'M17 7.5h4' }],
  ['path', { d: 'M17 16.5h4' }],
])

export const IconFile = icon('file', [
  ['path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' }],
  ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
])

export const IconPlay = icon('play', [
  ['path', { d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z' }],
])

export const IconPause = icon('pause', [
  ['rect', { x: '14', y: '3', width: '5', height: '18', rx: '1' }],
  ['rect', { x: '5', y: '3', width: '5', height: '18', rx: '1' }],
])

export const IconHourglass = icon('hourglass', [
  ['path', { d: 'M5 22h14' }],
  ['path', { d: 'M5 2h14' }],
  ['path', { d: 'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22' }],
  ['path', { d: 'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2' }],
])

export const IconCog = icon('cog', [
  ['path', { d: 'M11 10.27 7 3.34' }],
  ['path', { d: 'm11 13.73-4 6.93' }],
  ['path', { d: 'M12 22v-2' }],
  ['path', { d: 'M12 2v2' }],
  ['path', { d: 'M14 12h8' }],
  ['path', { d: 'm17 20.66-1-1.73' }],
  ['path', { d: 'm17 3.34-1 1.73' }],
  ['path', { d: 'M2 12h2' }],
  ['path', { d: 'm20.66 17-1.73-1' }],
  ['path', { d: 'm20.66 7-1.73 1' }],
  ['path', { d: 'm3.34 17 1.73-1' }],
  ['path', { d: 'm3.34 7 1.73 1' }],
  ['circle', { cx: '12', cy: '12', r: '2' }],
  ['circle', { cx: '12', cy: '12', r: '8' }],
])

export const IconCircleCheck = icon('circle-check', [
  ['circle', { cx: '12', cy: '12', r: '10' }],
  ['path', { d: 'm16 9-5.5 5.5L8 12' }],
])

export const IconTriangleAlert = icon('triangle-alert', [
  ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
  ['path', { d: 'M12 9v4' }],
  ['path', { d: 'M12 17h.01' }],
])

export const IconDownload = icon('download', [
  ['path', { d: 'M12 15V3' }],
  ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
  ['path', { d: 'm7 10 5 5 5-5' }],
])

export const IconUpload = icon('upload', [
  ['path', { d: 'M12 3v12' }],
  ['path', { d: 'm17 8-5-5-5 5' }],
  ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
])

export const IconX = icon('x', [
  ['path', { d: 'M18 6 6 18' }],
  ['path', { d: 'm6 6 12 12' }],
])

export const IconRotateCcw = icon('rotate-ccw', [
  ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
  ['path', { d: 'M3 3v5h5' }],
])

export const IconTrash = icon('trash', [
  ['path', { d: 'M10 11v6' }],
  ['path', { d: 'M14 11v6' }],
  ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
  ['path', { d: 'M3 6h18' }],
  ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
])
