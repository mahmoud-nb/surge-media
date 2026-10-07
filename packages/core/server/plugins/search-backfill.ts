import { mediaSearchColumns } from '#shared/utils/search'
import { bumpRevision } from '../lib/cache/revisions'
import type { Space } from '../utils/access'
import { isWorkerRole } from '../lib/video-processing/settings'

/**
 * Au démarrage, remplit les colonnes de recherche normalisées des médias qui n'en ont pas encore
 * (médias antérieurs à la migration `b3_api_read`) : la suppression des accents n'est pas
 * portable en SQL. Tâche de fond par lots, sans retarder le démarrage ; sans effet si tout est à jour.
 */
const BATCH = 200

async function backfill(): Promise<number> {
  const prisma = await usePrisma()
  let updated = 0
  const spaces = new Map<string, Space>()
  for (;;) {
    const batch = await prisma.media.findMany({
      where: { searchName: '' },
      select: { id: true, projectId: true, originalName: true, title: true, altText: true },
      take: BATCH,
    })
    for (const media of batch) {
      const columns = mediaSearchColumns(media)
      // Nom d'origine réduit à rien (improbable) : valeur non vide pour ne pas le retraiter en boucle.
      await prisma.media.update({ where: { id: media.id }, data: { ...columns, searchName: columns.searchName || '-' } })
      spaces.set(media.projectId ?? '', spaceFor(media.projectId))
    }
    updated += batch.length
    if (batch.length < BATCH) break
  }
  // Résultats de recherche modifiés : les ETag des listes concernées changent.
  await bumpRevision(...spaces.values())
  return updated
}

export default defineNitroPlugin(() => {
  // Processus de travail (phase D3) : tâche du serveur web (sans risque à plusieurs, mais inutile ici).
  if (isWorkerRole()) return
  void backfill()
    .then((count) => {
      if (count > 0) console.info(`[surge-media] Recherche : ${count} média(s) indexé(s).`)
    })
    .catch(error => console.error('[surge-media] Indexation de la recherche impossible :', error))
})
