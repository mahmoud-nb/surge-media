import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'

/**
 * Attend que la réponse dispose de sa connexion avant d'envoyer un flux.
 *
 * Connexion persistante (keep-alive) : une requête peut arriver avant que Node ait fini la réponse
 * précédente sur la même connexion (le client a reçu le dernier octet, le serveur n'a pas encore traité la
 * fin de son écriture). Node met alors la nouvelle réponse en file : `res.socket` reste null jusqu'à son
 * tour (événement `socket`). h3 1.15 (`sendStream`) prend ce cas pour un environnement sans connexion
 * (worker) et rend la main sans rien envoyer : réponse jamais écrite, client bloqué jusqu'à son propre
 * délai. Constaté au test de charge du 2026-10-10 sur `/m/` (≈ 1 requête sur 5 000 à 10 000 avec des
 * connexions persistantes, originaux comme dérivés) ; un mandataire qui réutilise ses connexions vers le
 * serveur (nginx `keepalive`) y est exposé en permanence.
 *
 * Résout `true` dès que la connexion est attribuée (aussitôt si c'est déjà le cas), `false` si le client
 * est parti entre-temps (rien à envoyer). À appeler **avant** d'ouvrir le fichier.
 */
export function responseReady(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (response.socket) return Promise.resolve(true)
  const connection = request.socket
  if (response.destroyed || response.writableEnded || !connection || connection.destroyed) return Promise.resolve(false)
  return new Promise((resolve) => {
    const settle = (ready: boolean) => () => {
      response.off('socket', onSocket)
      connection.off('close', onClose)
      resolve(ready)
    }
    const onSocket = settle(true)
    const onClose = settle(false)
    response.once('socket', onSocket)
    connection.once('close', onClose)
  })
}

/**
 * Ferme un flux de lecture si le client interrompt la réponse avant la fin (page quittée pendant le
 * chargement des aperçus, déplacement dans une vidéo, réseau coupé).
 *
 * h3 1.15 (`sendStream`) n'appelle que `stream.abort()` à la fermeture de la réponse : ni un flux de
 * fichier local (`fs.ReadStream`) ni le corps d'une réponse S3 n'ont cette méthode. Sans ce garde-fou,
 * le descripteur de fichier (limite de descripteurs, espace d'un fichier supprimé non libéré) ou la
 * connexion S3 (pool limité) restaient pris jusqu'au redémarrage du serveur — vérifié le 2026-10-05 :
 * 20 requêtes interrompues sur 20 laissaient leur fichier ouvert. Détruire un flux terminé est sans effet.
 */
export function closeWithResponse<T extends Readable>(response: ServerResponse, stream: T): T {
  // Client parti pendant l'ouverture du flux (lecture S3 asynchrone) : l'événement est déjà passé.
  if (response.destroyed) stream.destroy()
  else response.once('close', () => stream.destroy())
  return stream
}
