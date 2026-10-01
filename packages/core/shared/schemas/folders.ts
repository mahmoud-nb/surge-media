import { z } from 'zod'
import { FOLDER_NAME_MAX_LENGTH } from '../utils/folders'

/**
 * Dossiers dans l'administration (messages = clés i18n). Les noms sont normalisés (NFC, espaces
 * de bord retirés) ; ni barre oblique ni contrôle (chemins lisibles « A / B »), ni « . » / « .. ».
 * L'API v1 a ses propres schémas (shared/schemas/api.ts, messages en anglais).
 */

const FORBIDDEN_CHARACTERS = /[\p{Cc}/\\]/u

export function isValidFolderName(name: string): boolean {
  return !FORBIDDEN_CHARACTERS.test(name) && name !== '.' && name !== '..'
}

export const folderNameSchema = z
  .string('validation.required')
  .transform(value => value.normalize('NFC').trim())
  .pipe(z
    .string()
    .min(1, 'validation.required')
    .max(FOLDER_NAME_MAX_LENGTH, 'validation.tooLong')
    .refine(isValidFolderName, 'validation.folderName'))

/** Identifiant de dossier reçu d'un client (existence et espace vérifiés par le serveur). */
export const folderIdSchema = z.string().trim().min(1).max(64)

/** Formulaire « Nouveau dossier » / « Renommer ». */
export const folderFormSchema = z.object({ name: folderNameSchema })

export const createFolderSchema = z.object({
  name: folderNameSchema,
  /** Dossier parent ; absent ou null = racine de l'espace. */
  parentId: folderIdSchema.nullable().optional(),
})

export const updateFolderSchema = z.object({
  name: folderNameSchema.optional(),
  /** Nouveau parent ; null = racine ; absent = inchangé. */
  parentId: folderIdSchema.nullable().optional(),
})

/** Suppression : `content=parent` remonte d'abord le contenu (médias, sous-dossiers) dans le parent. */
export const deleteFolderQuerySchema = z.object({
  content: z.enum(['parent']).optional().catch(undefined),
})

/** Rangement groupé de médias d'un espace dans un dossier (null = racine). */
export const assignFolderSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
  folderId: folderIdSchema.nullable(),
})
