import type { Preset, Project, TransformFormat, TransformPolicy } from '../types'
import { ALL_FORMATS } from '../urls/picture'
import { BUILTIN_PRESETS } from '../urls/srcset'
import { DEFAULT_MAX_DIMENSION } from '../urls/transform'

/** Réglages utilisés tant que le projet n'est pas lu (ou sans client) : rendu serveur déterministe. */
export interface DisplayDefaults {
  /** Formats de sortie activés sur le serveur (sinon ceux du projet ; à défaut, les quatre). */
  formats?: TransformFormat[]
  /** Politique de transformation (sinon celle du projet ; à défaut, `open`). */
  policy?: TransformPolicy
  /** Dimension maximale d'un dérivé (sinon celle du projet ; à défaut, 4096). */
  maxDimension?: number
  /** Largeurs des srcset (sinon celles du client). */
  widths?: number[]
  /** Format des images seules (`<img>`) : WebP par défaut. */
  imageFormat?: TransformFormat
}

/** Réglages effectifs du projet pour construire les URL. */
export interface ProjectSettings {
  policy: TransformPolicy | null
  formats: readonly TransformFormat[]
  maxDimension: number
}

/** Ce que les composants d'affichage savent du projet : réglages effectifs, préréglages connus, valeurs par défaut. */
export interface DisplaySettings extends ProjectSettings {
  /** Préréglages connus : intégrés, puis ceux du projet. */
  presets: readonly Preset[]
  /** Largeurs des srcset (sinon celles du client). */
  widths?: readonly number[]
  /** Format des images seules (`<img>`) : WebP par défaut. */
  imageFormat?: TransformFormat
}

/** Réglages du projet lu, sinon les valeurs par défaut de l'application, sinon celles du serveur. */
export function projectSettings(
  project: Pick<Project, 'transformPolicy' | 'transformFormats' | 'transformMaxDimension'> | null | undefined,
  defaults: DisplayDefaults = {},
): ProjectSettings {
  return {
    policy: project?.transformPolicy ?? defaults.policy ?? null,
    formats: project?.transformFormats ?? defaults.formats ?? ALL_FORMATS,
    maxDimension: project?.transformMaxDimension ?? defaults.maxDimension ?? DEFAULT_MAX_DIMENSION,
  }
}

/** Préréglages connus : les intégrés (sauf ceux que le projet redéfinit), puis ceux du projet une fois lus. */
export function knownPresets(projectPresets: readonly Preset[] | null | undefined): Preset[] {
  const custom = projectPresets ?? []
  return [...BUILTIN_PRESETS.filter(builtin => !custom.some(preset => preset.name === builtin.name)), ...custom]
}

/** Réglages complets des composants d'affichage : `projectSettings` + `knownPresets` + largeurs et format par défaut. */
export function displaySettings(settings: ProjectSettings, presets: readonly Preset[], defaults: DisplayDefaults = {}): DisplaySettings {
  return { ...settings, presets, widths: defaults.widths, imageFormat: defaults.imageFormat }
}
