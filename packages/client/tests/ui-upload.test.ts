import { describe, expect, it } from 'vitest'
import { SurgeApiError } from '../src/errors'
import type { UploadRules } from '../src/types'
import { createTranslate } from '../src/ui/i18n'
import {
  awaitingUploads,
  canCancelUpload,
  canRemoveUpload,
  canRetryUpload,
  previewableUpload,
  sentUploads,
  showsUploadError,
  showsVisibilityChoice,
  takeSettledUploads,
  uploaderAccept,
  uploaderFields,
  uploaderKinds,
  uploadHelpLines,
  uploadStatusText,
} from '../src/ui/uploader'
import type { UploadItem, UploadStatus } from '../src/upload/queue'
import { acceptAttribute } from '../src/upload/rules'
import { imageMedia, videoMedia } from './fixtures'

/**
 * Affichage d'un composant d'envoi sans framework (la file elle-même est couverte par upload.test.ts) :
 * genres et `accept`, champs envoyés, aide, actions possibles, texte d'état, résumé de fin de file.
 */

const rules: UploadRules = {
  types: [
    { mimeType: 'image/jpeg', extension: 'jpg', kind: 'image', maxSize: 1000, converted: false },
    { mimeType: 'image/png', extension: 'png', kind: 'image', maxSize: 1000, converted: false },
    { mimeType: 'video/mp4', extension: 'mp4', kind: 'video', maxSize: 5000, converted: false },
    { mimeType: 'video/mp2t', extension: 'ts', kind: 'video', maxSize: 5000, converted: true },
  ],
  remaining: null,
  visibility: null,
  folderId: null,
}

const t = createTranslate('fr')

function item(status: UploadStatus, extra: Partial<UploadItem> = {}): UploadItem {
  return {
    id: `item-${status}`,
    file: new Blob(['x'], { type: 'image/png' }),
    name: 'photo.png',
    size: 1,
    kind: 'image',
    status,
    progress: null,
    fields: {},
    media: null,
    error: null,
    attempts: 0,
    retryAt: null,
    ...extra,
  }
}

const error = (code: string) => new SurgeApiError({ status: 0, code })

describe('genres, accept, champs', () => {
  it('genres : ceux des règles parmi ceux demandés ; sans règles, ceux demandés ou images et vidéos', () => {
    expect(uploaderKinds(null)).toEqual(['image', 'video'])
    expect(uploaderKinds(null, ['video'])).toEqual(['video'])
    expect(uploaderKinds(rules, ['video'])).toEqual(['video'])
    expect(uploaderKinds({ ...rules, types: rules.types.slice(0, 2) })).toEqual(['image'])
  })

  it('accept : types et extensions des règles, sinon les genres', () => {
    expect(uploaderAccept(rules, ['image'])).toBe(acceptAttribute(rules, ['image']))
    expect(uploaderAccept(null)).toBe('image/*,video/*')
    expect(uploaderAccept(undefined, ['video'])).toBe('video/*')
  })

  it('visibilité et dossier : choisis ou donnés, jamais envoyés s\'ils sont imposés par le jeton', () => {
    expect(showsVisibilityChoice(rules, true)).toBe(true)
    expect(showsVisibilityChoice({ ...rules, visibility: 'private' }, true)).toBe(false)
    expect(showsVisibilityChoice(rules)).toBe(false)
    expect(uploaderFields(rules, { visibility: 'private', folderId: 'cmfolder001' })).toEqual({ visibility: 'private', folderId: 'cmfolder001' })
    expect(uploaderFields(rules, { visibility: 'public', chooseVisibility: true, selectedVisibility: 'private' })).toEqual({ visibility: 'private' })
    expect(uploaderFields({ ...rules, visibility: 'public', folderId: 'cmfolder002' }, { visibility: 'private', folderId: 'cmfolder001' })).toEqual({})
    expect(uploaderFields(null, {})).toEqual({})
  })
})

describe('aide reliée au champ', () => {
  it('types et taille maximale par genre, formats convertis, envois restants moins ceux partis', () => {
    const lines = uploadHelpLines({ ...rules, remaining: 5 }, ['image', 'video'], 2, t, 'fr')
    expect(lines.map(line => line.key)).toEqual(['image', 'video', 'converted', 'remaining'])
    expect(lines[0]!.text).toMatch(/^Images : JPG, PNG, .+ au plus\.$/)
    expect(lines[1]!.text).toMatch(/^Vidéos : MP4, .+ au plus\.$/)
    expect(lines[2]!.text).toBe('Vidéos converties après l\'envoi : TS.')
    expect(lines[3]!.text).toBe('Envois restants : 3.')
    expect(uploadHelpLines({ ...rules, remaining: 1 }, ['image'], 4, t, 'fr').map(line => line.text)).toContain('Envois restants : 0.')
  })

  it('fichiers partis : en cours d\'envoi, affiche, envoyés', () => {
    expect(sentUploads([item('queued'), item('uploading'), item('poster'), item('done'), item('error'), item('canceled')])).toBe(3)
  })
})

describe('fichiers de la file', () => {
  it('actions possibles : annuler, réessayer (sauf refus définitif), retirer', () => {
    expect(['queued', 'uploading', 'poster', 'done'].map(status => canCancelUpload(item(status as UploadStatus)))).toEqual([true, true, false, false])
    expect(canRetryUpload(item('canceled'))).toBe(true)
    expect(canRetryUpload(item('error', { error: error('NETWORK_ERROR') }))).toBe(true)
    expect(canRetryUpload(item('error', { error: error('FILE_TOO_LARGE') }))).toBe(false)
    expect(canRetryUpload(item('done'))).toBe(false)
    expect(['done', 'error', 'canceled', 'uploading'].map(status => canRemoveUpload(item(status as UploadStatus)))).toEqual([true, true, true, false])
  })

  it('erreur montrée : échec, ou nouvel essai programmé', () => {
    expect(showsUploadError(item('error', { error: error('SERVER_BUSY') }))).toBe(true)
    expect(showsUploadError(item('queued', { error: error('SERVER_BUSY'), retryAt: 1 }))).toBe(true)
    expect(showsUploadError(item('queued', { error: error('SERVER_BUSY') }))).toBe(false)
    expect(showsUploadError(item('error'))).toBe(false)
  })

  it('mode « détails » : fichiers jamais essayés ni déjà lancés', () => {
    const items = [item('queued', { id: 'a' }), item('queued', { id: 'b', attempts: 1 }), item('queued', { id: 'c' }), item('done', { id: 'd' })]
    expect(awaitingUploads(items, new Set(['c'])).map(entry => entry.id)).toEqual(['a'])
  })

  it('aperçu local : images d\'un type connu seulement', () => {
    expect(previewableUpload(item('queued'))).toBe(true)
    expect(previewableUpload(item('queued', { file: new Blob(['x'], { type: 'video/mp4' }) }))).toBe(false)
    expect(previewableUpload(item('queued', { file: new Blob(['x']) }))).toBe(false)
  })

  it('texte de l\'état, avec le pourcentage pendant l\'envoi', () => {
    expect(uploadStatusText(item('queued'), t, 'fr')).toBe('En attente')
    expect(uploadStatusText(item('queued', { retryAt: 1 }), t, 'fr')).toBe('Nouvel essai dans un instant')
    expect(uploadStatusText(item('uploading', { progress: 0.45 }), t, 'en')).toBe('Envoi en cours : 45%')
    expect(uploadStatusText(item('done'), createTranslate('en'), 'en')).toBe('Uploaded')
  })

  it('fin de file : fichiers terminés depuis le précédent résumé', () => {
    const reported = new Set<string>()
    const items = [
      item('done', { id: 'a', media: imageMedia }),
      item('error', { id: 'b', error: error('FILE_TOO_LARGE') }),
      item('uploading', { id: 'c' }),
    ]
    expect(takeSettledUploads(items, reported)).toEqual({ media: [imageMedia], total: 2, failed: 1 })
    const later = [...items.slice(0, 2), item('done', { id: 'c', media: videoMedia })]
    expect(takeSettledUploads(later, reported)).toEqual({ media: [videoMedia], total: 1, failed: 0 })
    expect(takeSettledUploads(later, reported)).toEqual({ media: [], total: 0, failed: 0 })
  })
})
