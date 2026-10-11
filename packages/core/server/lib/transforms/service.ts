import {
  BUILTIN_PRESETS,
  isReservedPresetName,
  parsePresetDefinition,
  parseTransformation,
  PRESETS_PER_LEVEL_MAX,
  TRANSFORM_POLICIES,
  type PresetLevel,
  type Transformation,
  type TransformErrorCode,
  type TransformFormat,
  type TransformPolicy,
} from '#shared/utils/transforms'
import type { TransformPreset } from '../../generated/prisma/client'
import { createLruCache } from '../cache/lru'
import { useTransformSettings } from '../media/transform-settings'
import { getProjectState, invalidateProjectState } from '../projects/state'

/**
 * Politique des transformations et préréglages (phase C, sous-étape C2 ; architecture § 5 et § 9).
 *
 *  - Politique d'un espace : `Project.transformPolicy` (état du projet, cache 60 s) ou, pour la
 *    bibliothèque, le réglage de l'installation `transforms.libraryPolicy` (modèle Setting).
 *  - Préréglages : intégrés (code), globaux (`projectId` null, ADMIN) et de projet
 *    (`project:settings`) ; un préréglage de projet masque un global du même nom ; les noms intégrés
 *    sont réservés. Résolution sans requête sur le chemin chaud (caches, invalidés à chaque écriture
 *    locale ; autres instances : ≤ 60 s).
 */

const LIBRARY_POLICY_KEY = 'transforms.libraryPolicy'

export interface PresetRecord {
  id: string
  name: string
  /** Transformation canonique, sans format. */
  transformation: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

interface InstallationTransforms {
  libraryPolicy: TransformPolicy
  /** Préréglages globaux, triés par nom. */
  presets: PresetRecord[]
}

const installationCache = createLruCache<InstallationTransforms>({ max: 1, ttlMs: 60_000 })

/** Erreur métier des préréglages : statut HTTP + code (`data.code`) traduit par l'interface. */
export function transformError(statusCode: 400 | 404 | 409, code: TransformErrorCode, details: Record<string, unknown> = {}) {
  return createError({ statusCode, statusMessage: code, data: { code, ...details } })
}

function isPolicy(value: unknown): value is TransformPolicy {
  return typeof value === 'string' && (TRANSFORM_POLICIES as readonly string[]).includes(value)
}

/** Politique de la bibliothèque et préréglages globaux (cache 60 s). */
export async function getInstallationTransforms(): Promise<InstallationTransforms> {
  const cached = installationCache.get('installation')
  if (cached) return cached
  const prisma = await usePrisma()
  const [setting, presets] = await Promise.all([
    prisma.setting.findUnique({ where: { key: LIBRARY_POLICY_KEY } }),
    prisma.transformPreset.findMany({
      where: { projectId: null },
      select: { id: true, name: true, transformation: true, description: true, createdAt: true, updatedAt: true },
      orderBy: { name: 'asc' },
    }),
  ])
  const state = { libraryPolicy: isPolicy(setting?.value) ? setting.value : 'OPEN' as const, presets }
  installationCache.set('installation', state)
  return state
}

export function invalidateInstallationTransforms(): void {
  installationCache.clear()
}

/** Politique des transformations libres d'un espace (projet, ou bibliothèque si null). */
export async function spaceTransformPolicy(projectId: string | null): Promise<TransformPolicy> {
  if (!projectId) return (await getInstallationTransforms()).libraryPolicy
  return (await getProjectState(projectId))?.transformPolicy ?? 'OPEN'
}

export interface ResolvedPreset {
  name: string
  level: PresetLevel
  /** Définition enregistrée (forme canonique, sans format). */
  definition: string
  /** null si la définition n'est plus valable (borne de l'installation abaissée depuis) : `error`. */
  transformation: Transformation | null
  error: string | null
}

function resolved(name: string, level: PresetLevel, definition: string): ResolvedPreset {
  const parsed = parseTransformation(definition, useTransformSettings())
  return parsed.ok
    ? { name, level, definition, transformation: parsed.transformation, error: null }
    : { name, level, definition, transformation: null, error: `Preset "${name}" is no longer valid on this server: ${parsed.message}` }
}

/** Préréglage d'un espace par son nom : intégré, puis du projet, puis global ; null s'il n'existe pas. */
export async function resolvePreset(projectId: string | null, name: string): Promise<ResolvedPreset | null> {
  if (Object.hasOwn(BUILTIN_PRESETS, name)) return resolved(name, 'builtin', BUILTIN_PRESETS[name as keyof typeof BUILTIN_PRESETS])
  if (isReservedPresetName(name)) return null
  if (projectId) {
    const own = (await getProjectState(projectId))?.presets.find(preset => preset.name === name)
    if (own) return resolved(name, 'project', own.transformation)
  }
  const global = (await getInstallationTransforms()).presets.find(preset => preset.name === name)
  return global ? resolved(name, 'global', global.transformation) : null
}

export interface PresetSummary {
  id: string | null
  name: string
  transformation: string
  description: string | null
  level: PresetLevel
  /** Préréglage global masqué par un préréglage du projet portant le même nom. */
  shadowed: boolean
  updatedAt: Date | null
}

function summary(preset: PresetRecord, level: PresetLevel, shadowed = false): PresetSummary {
  return { id: preset.id, name: preset.name, transformation: preset.transformation, description: preset.description, level, shadowed, updatedAt: preset.updatedAt }
}

/**
 * Politique et préréglages d'un niveau, tels que présentés à l'administration : intégrés, globaux
 * (masqués ou non par le projet), puis ceux du projet. `projectId` null = installation.
 */
export async function describeTransforms(projectId: string | null) {
  const installation = await getInstallationTransforms()
  const project = projectId ? await getProjectState(projectId) : null
  const own = new Set(project?.presets.map(preset => preset.name))
  const presets: PresetSummary[] = [
    ...Object.entries(BUILTIN_PRESETS).map(([name, transformation]) => ({ id: null, name, transformation, description: null, level: 'builtin' as const, shadowed: false, updatedAt: null })),
    ...installation.presets.map(preset => summary(preset, 'global', own.has(preset.name))),
    ...(project?.presets ?? []).map(preset => summary(preset, 'project')),
  ]
  const settings = useTransformSettings()
  return {
    policy: project ? project.transformPolicy : installation.libraryPolicy,
    presets,
    limits: {
      maxDimension: settings.maxDimension,
      formats: settings.formats,
      maxVariants: settings.maxVariants,
      rateLimit: settings.rateLimit,
      presetMaxAge: settings.presetMaxAge,
      presetsMax: PRESETS_PER_LEVEL_MAX,
    },
  }
}

/**
 * Préréglages utilisables dans un espace (API v1, générateur d'adresses) : intégrés, du projet,
 * globaux non masqués. `projectId` null = bibliothèque (intégrés et globaux).
 */
export async function projectPresets(projectId: string | null): Promise<PresetSummary[]> {
  const { presets } = await describeTransforms(projectId)
  return presets.filter(preset => !preset.shadowed)
}

/** Ce que le générateur d'adresses de la fiche média propose dans un espace (média de cet espace). */
export async function spaceTransformOptions(projectId: string | null) {
  const { policy, presets, limits } = await describeTransforms(projectId)
  return {
    policy,
    presets: presets
      .filter(preset => !preset.shadowed)
      .map(preset => ({ name: preset.name, transformation: preset.transformation, description: preset.description, level: preset.level })),
    formats: limits.formats,
    maxDimension: limits.maxDimension,
  }
}

/** Dérivé demandé par son préréglage ou ses paramètres (forme libre), et son format de sortie. */
export interface TransformRequest {
  preset?: string
  transform?: string
  format: TransformFormat
}

export type ResolvedTransformRequest
  = | { kind: 'preset', name: string, transformation: Transformation }
  /** `canonical` vide : image entière réencodée (préréglage intégré `full`). */
    | { kind: 'transform', canonical: string, transformation: Transformation }

/**
 * Transformation d'un dérivé demandé dans un espace : format activé, paramètres analysés avec les
 * bornes de l'installation, ou préréglage de l'espace. Erreurs métier (`data.code`) : 400
 * INVALID_TRANSFORM (`param`, `detail`), 404 PRESET_NOT_FOUND — converties en problèmes par l'API v1.
 */
export async function resolveTransformRequest(projectId: string | null, request: TransformRequest): Promise<ResolvedTransformRequest> {
  const settings = useTransformSettings()
  if (!settings.formats.includes(request.format)) {
    throw transformError(400, 'INVALID_TRANSFORM', {
      param: 'format',
      detail: `Output format "${request.format}" is not enabled on this server (${settings.formats.join(', ')}).`,
    })
  }
  if (request.transform !== undefined) {
    const parsed = parseTransformation(request.transform, settings)
    if (!parsed.ok) throw transformError(400, 'INVALID_TRANSFORM', { param: parsed.param, detail: parsed.message })
    return { kind: 'transform', canonical: parsed.canonical, transformation: parsed.transformation }
  }
  const name = request.preset ?? 'preview'
  const preset = await resolvePreset(projectId, name)
  if (!preset) throw transformError(404, 'PRESET_NOT_FOUND', { detail: `No preset "${name}" in this space.` })
  if (!preset.transformation) throw transformError(400, 'INVALID_TRANSFORM', { detail: preset.error })
  return { kind: 'preset', name, transformation: preset.transformation }
}

// ─── Écritures ───────────────────────────────────────────────────────────────

function invalidate(projectId: string | null): void {
  if (projectId) invalidateProjectState(projectId)
  else invalidateInstallationTransforms()
}

/** Définition vérifiée avec les bornes de l'installation → forme canonique (400 INVALID_TRANSFORM sinon). */
function canonicalDefinition(definition: string): string {
  const parsed = parsePresetDefinition(definition, useTransformSettings())
  if (!parsed.ok) throw transformError(400, 'INVALID_TRANSFORM', { param: parsed.param, detail: parsed.message })
  return parsed.canonical
}

export async function findPreset(id: string): Promise<TransformPreset | null> {
  const prisma = await usePrisma()
  return prisma.transformPreset.findUnique({ where: { id } })
}

export async function setTransformPolicy(projectId: string | null, policy: TransformPolicy): Promise<TransformPolicy> {
  const prisma = await usePrisma()
  const previous = await spaceTransformPolicy(projectId)
  if (projectId) await prisma.project.update({ where: { id: projectId }, data: { transformPolicy: policy } })
  else await prisma.setting.upsert({ where: { key: LIBRARY_POLICY_KEY }, create: { key: LIBRARY_POLICY_KEY, value: policy }, update: { value: policy } })
  invalidate(projectId)
  return previous
}

export interface PresetInput {
  name?: string
  transformation?: string
  description?: string | null
}

export async function createPreset(projectId: string | null, input: Required<Pick<PresetInput, 'name' | 'transformation'>> & PresetInput): Promise<TransformPreset> {
  const transformation = canonicalDefinition(input.transformation)
  const prisma = await usePrisma()
  const created = await prisma.$transaction(async (tx) => {
    if (await tx.transformPreset.count({ where: { projectId } }) >= PRESETS_PER_LEVEL_MAX) {
      throw transformError(409, 'PRESET_LIMIT_REACHED', { max: PRESETS_PER_LEVEL_MAX })
    }
    if (await tx.transformPreset.findFirst({ where: { projectId, name: input.name }, select: { id: true } })) {
      throw transformError(409, 'PRESET_NAME_TAKEN')
    }
    return tx.transformPreset.create({ data: { projectId, name: input.name, transformation, description: input.description ?? null } })
  })
  invalidate(projectId)
  return created
}

export async function updatePreset(preset: TransformPreset, input: PresetInput): Promise<TransformPreset> {
  const transformation = input.transformation === undefined ? undefined : canonicalDefinition(input.transformation)
  const prisma = await usePrisma()
  const updated = await prisma.$transaction(async (tx) => {
    if (input.name !== undefined && input.name !== preset.name
      && await tx.transformPreset.findFirst({ where: { projectId: preset.projectId, name: input.name }, select: { id: true } })) {
      throw transformError(409, 'PRESET_NAME_TAKEN')
    }
    return tx.transformPreset.update({
      where: { id: preset.id },
      data: { name: input.name, transformation, description: input.description },
    })
  })
  invalidate(preset.projectId)
  return updated
}

export async function deletePreset(preset: TransformPreset): Promise<void> {
  const prisma = await usePrisma()
  await prisma.transformPreset.delete({ where: { id: preset.id } })
  invalidate(preset.projectId)
}

/** Représentation d'un préréglage enregistré pour l'administration. */
export function toPresetSummary(preset: TransformPreset): PresetSummary {
  return summary(preset, preset.projectId ? 'project' : 'global')
}
