import { mediaError } from '../errors'
import { parseVideoPreparation, type PreparationOptions, preparedStream, prepareVideo } from '../video/prepare'
import { convertedContainerFor, convertedVideoMetadata, probeVideoFile, VideoProbeError } from '../video/probe'
import { withFileSource } from '../video/source'
import type { MediaTypeHandler } from './types'

/**
 * Vidéos (phase D) : pas de transformation ni d'aperçu (pas de `transform`). L'analyse ne lit que les
 * en-têtes (aucun décodage) : elle ne passe pas par la file des traitements d'images, qui pourrait sinon
 * refuser (503) un envoi de plusieurs minutes. Phase D2 : les MP4/MOV sont **préparés** avant d'être
 * stockés (index en tête, métadonnées d'origine retirées : video/prepare.ts), sans réencodage et sans
 * passage de plus sur le fichier ; au moindre doute, le fichier est gardé tel qu'envoyé.
 *
 * Phase D3 : les conteneurs convertis (MKV, AVI…), acceptés seulement quand le traitement est actif, ne
 * sont ni lus ni préparés ici : stockés tels qu'envoyés, ils sont analysés par ffprobe dans la tâche de
 * traitement (dimensions, durée, codecs inconnus jusque-là). Un fichier sans vidéo ou illisible y échoue
 * avec un code affiché dans la fiche : le refus ne peut plus être immédiat (ffprobe ne tourne jamais
 * dans une requête).
 */

let preparation: PreparationOptions | undefined

/** Préparation activée (NUXT_MEDIA_VIDEO_PREPARE), lue une fois. */
export function useVideoPreparation(): PreparationOptions {
  preparation ??= parseVideoPreparation(useRuntimeConfig().media.videoPrepare, message => console.warn(message))
  return preparation
}

/** Raisons de garder un fichier tel quel qui ne méritent pas d'être signalées. */
const EXPECTED_SKIPS = new Set(['not an ISO BMFF file', 'fragmented file'])

export const videoHandler: MediaTypeHandler = {
  kind: 'VIDEO',
  queued: false,

  async inspect(path, mimeType) {
    const converted = convertedContainerFor(mimeType)
    if (converted) return { width: null, height: null, duration: null, metadata: { ...convertedVideoMetadata(converted) } }
    try {
      const probe = await probeVideoFile(path, mimeType)
      return { width: probe.width, height: probe.height, duration: probe.duration, metadata: { ...probe.metadata } }
    }
    catch (error) {
      if (!(error instanceof VideoProbeError)) throw error
      // Pas de piste vidéo (audio seul) : type non accepté ; sinon fichier illisible.
      if (error.reason === 'no-video') throw mediaError(415, 'UNSUPPORTED_TYPE', { detail: error.message })
      throw mediaError(422, 'UNREADABLE_FILE', { detail: error.message })
    }
  },

  async prepare(path, mimeType, inspected) {
    // Conteneur converti : jamais servi à `<video>`, rien à préparer (`prepared: []` dès l'analyse).
    if (convertedContainerFor(mimeType)) return { inspected, file: null }
    const options = useVideoPreparation()
    // Préparation désactivée : `prepared` reste null (fichier jamais examiné).
    if (!options.faststart && !options.metadata) return { inspected, file: null }

    const outcome = await withFileSource(path, source => prepareVideo(source, mimeType, options))
    if (outcome.status === 'prepared') {
      const { probe, plan } = outcome
      return {
        inspected: { width: probe.width, height: probe.height, duration: probe.duration, metadata: { ...probe.metadata } },
        file: { size: plan.size, open: () => preparedStream(path, plan) },
      }
    }
    if (outcome.status === 'skipped' && !EXPECTED_SKIPS.has(outcome.reason)) {
      console.warn(`[surge-media] Vidéo gardée telle qu'envoyée (préparation impossible : ${outcome.reason}).`)
    }
    // Examinée : rien à faire (déjà prête, WebM, MP4 fragmenté) ou préparation impossible.
    return { inspected: { ...inspected, metadata: { ...inspected.metadata, prepared: [] } }, file: null }
  },
}
