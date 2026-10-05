import { mediaError } from '../errors'
import { probeVideoFile, VideoProbeError } from '../video/probe'
import type { MediaTypeHandler } from './types'

/**
 * Vidéos (phase D1) : fichier stocké et servi tel qu'envoyé, sans transformation ni aperçu (pas de
 * `transform`). L'analyse ne lit que les en-têtes (aucun décodage) : elle ne passe pas par la file
 * des traitements d'images, qui pourrait sinon refuser (503) un envoi de plusieurs minutes.
 */
export const videoHandler: MediaTypeHandler = {
  kind: 'VIDEO',
  queued: false,

  async inspect(path, mimeType) {
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
}
