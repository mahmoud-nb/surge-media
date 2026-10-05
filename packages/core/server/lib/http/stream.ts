import type { ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'

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
