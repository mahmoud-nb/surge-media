import { formatBytes, formatPercent } from '../format'
import type { Media, MediaKind, MediaVisibility, UploadFields, UploadRules } from '../types'
import { UPLOAD_FILE_TYPES } from '../upload/file-types'
import type { UploadItem } from '../upload/queue'
import { acceptAttribute, acceptedExtensions, maxSizeFor, uploadKinds } from '../upload/rules'
import type { Translate } from './i18n'

/**
 * Logique d'affichage d'un composant d'envoi sans framework (la file elle-même : `createUploadQueue`) :
 * genres proposés et attribut `accept`, champs envoyés, aide reliée au champ, actions possibles sur chaque
 * fichier, texte de son état, résumé de fin de file.
 */

/** Genres proposés : ceux que les règles acceptent parmi `kinds` ; sans règles, `kinds` (images et vidéos par défaut). */
export function uploaderKinds(rules: UploadRules | null | undefined, kinds?: readonly MediaKind[]): MediaKind[] {
  if (rules) return uploadKinds(rules, kinds)
  return kinds ? [...kinds] : ['image', 'video']
}

/** Attribut `accept` du champ de fichier : types et extensions des règles, sinon `image/*,video/*`. */
export function uploaderAccept(rules: UploadRules | null | undefined, kinds?: readonly MediaKind[]): string {
  return rules ? acceptAttribute(rules, kinds) : uploaderKinds(null, kinds).map(kind => `${kind}/*`).join(',')
}

/** Choix de la visibilité montré : demandé, et la visibilité n'est pas imposée par le jeton. */
export function showsVisibilityChoice(rules: UploadRules | null | undefined, chooseVisibility = false): boolean {
  return chooseVisibility && !rules?.visibility
}

export interface UploaderFieldOptions {
  /** Visibilité des fichiers (`public` par défaut côté serveur). */
  visibility?: MediaVisibility
  /** L'utilisateur choisit la visibilité : `selectedVisibility` l'emporte sur `visibility`. */
  chooseVisibility?: boolean
  selectedVisibility?: MediaVisibility
  folderId?: string
}

/** Champs envoyés avec chaque fichier ; une visibilité ou un dossier imposés par le jeton ne sont pas envoyés. */
export function uploaderFields(rules: UploadRules | null | undefined, options: UploaderFieldOptions): UploadFields {
  const visibility = rules?.visibility ? undefined : options.chooseVisibility ? options.selectedVisibility : options.visibility
  const folderId = rules?.folderId ? undefined : options.folderId
  return { ...(visibility ? { visibility } : {}), ...(folderId ? { folderId } : {}) }
}

/** Fichiers partis (en cours d'envoi, affiche, envoyés) : décomptés des envois restants. */
export function sentUploads(items: readonly Pick<UploadItem, 'status'>[]): number {
  return items.filter(item => item.status === 'uploading' || item.status === 'poster' || item.status === 'done').length
}

export interface UploadHelpLine {
  key: string
  text: string
}

/**
 * Aide reliée au champ (`aria-describedby`) : types et taille maximale par genre, formats convertis après
 * l'envoi, envois restants (moins `sent`, les fichiers déjà partis depuis la lecture des règles).
 */
export function uploadHelpLines(rules: UploadRules, kinds: readonly MediaKind[], sent: number, t: Translate, locale: string): UploadHelpLine[] {
  const lines: UploadHelpLine[] = []
  for (const kind of kinds) {
    const types = acceptedExtensions(rules, [kind], { converted: false }).map(extension => extension.toUpperCase()).join(', ')
    if (types) lines.push({ key: kind, text: t(`upload.help.${kind}`, { types, max: formatBytes(maxSizeFor(rules, kind), locale) }) })
  }
  const converted = rules.types.filter(type => type.converted && kinds.includes(type.kind))
  if (converted.length > 0) {
    lines.push({ key: 'converted', text: t('upload.help.converted', { types: [...new Set(converted.map(type => type.extension.toUpperCase()))].join(', ') }) })
  }
  if (rules.remaining !== null) lines.push({ key: 'remaining', text: t('upload.help.remaining', { count: Math.max(0, rules.remaining - sent) }) })
  return lines
}

/** Refus définitifs : un nouvel essai donnerait le même résultat (pas de « Réessayer »). */
export const PERMANENT_UPLOAD_ERRORS: ReadonlySet<string> = new Set(['FILE_TOO_LARGE', 'UNSUPPORTED_TYPE', 'UNREADABLE_FILE', 'DIMENSIONS_TOO_LARGE', 'NO_FILE', 'KIND_MISMATCH'])

/** « Annuler » : fichier en attente ou en cours d'envoi. */
export function canCancelUpload(item: Pick<UploadItem, 'status'>): boolean {
  return item.status === 'queued' || item.status === 'uploading'
}

/** « Réessayer » : fichier annulé, ou en échec pour une raison passagère. */
export function canRetryUpload(item: Pick<UploadItem, 'status' | 'error'>): boolean {
  return item.status === 'canceled' || (item.status === 'error' && !PERMANENT_UPLOAD_ERRORS.has(item.error?.code ?? ''))
}

/** « Retirer » : fichier terminé (envoyé, en échec ou annulé). */
export function canRemoveUpload(item: Pick<UploadItem, 'status'>): boolean {
  return item.status === 'done' || item.status === 'error' || item.status === 'canceled'
}

/** Erreur à montrer sous un fichier : échec, ou nouvel essai automatique programmé. */
export function showsUploadError(item: Pick<UploadItem, 'status' | 'error' | 'retryAt'>): boolean {
  return item.error !== null && (item.status === 'error' || item.retryAt !== null)
}

/** Fichiers à lancer par « Envoyer les fichiers » (mode « détails ») : jamais essayés ni déjà lancés. */
export function awaitingUploads<T extends Pick<UploadItem, 'id' | 'status' | 'attempts'>>(items: readonly T[], launched: ReadonlySet<string>): T[] {
  return items.filter(item => item.status === 'queued' && item.attempts === 0 && !launched.has(item.id))
}

/** Aperçu local possible (image d'un type connu). */
export function previewableUpload(item: Pick<UploadItem, 'file'>): boolean {
  return UPLOAD_FILE_TYPES[item.file.type]?.kind === 'image'
}

/** Texte de l'état d'un fichier (`upload.status.*`), avec le pourcentage pendant l'envoi. */
export function uploadStatusText(item: Pick<UploadItem, 'status' | 'retryAt' | 'progress'>, t: Translate, locale: string): string {
  if (item.status === 'queued') return t(item.retryAt === null ? 'upload.status.queued' : 'upload.status.retrying')
  if (item.status === 'uploading') return t('upload.status.uploading', { percent: formatPercent(item.progress ?? 0, locale) })
  return t(`upload.status.${item.status}`)
}

export interface SettledUploads {
  /** Médias créés depuis le précédent appel. */
  media: Media[]
  /** Fichiers terminés depuis le précédent appel (envoyés ou en échec). */
  total: number
  failed: number
}

/**
 * Fin de file (`onSettled`) : fichiers terminés pas encore signalés, ajoutés à `reported`. Le résumé
 * (`upload.announce.summary`) ne s'annonce que pour plusieurs fichiers.
 */
export function takeSettledUploads(items: readonly UploadItem[], reported: Set<string>): SettledUploads {
  const finished = items.filter(item => (item.status === 'done' || item.status === 'error') && !reported.has(item.id))
  for (const item of finished) reported.add(item.id)
  const media = finished.flatMap(item => (item.status === 'done' && item.media ? [item.media] : []))
  return { media, total: finished.length, failed: finished.length - media.length }
}
