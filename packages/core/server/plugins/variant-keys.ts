import { useMediaStorage } from '../lib/storage'
import { planTransform } from '../lib/media/transform-plan'
import { useTransformSettings } from '../lib/media/transform-settings'
import { previewRequest, transformSource } from '../lib/media/variants'

/**
 * Au démarrage, reprend les aperçus générés avant la phase C (`MediaVariant.transformation` =
 * « v<n>/preview ») sous l'identifiant de leur opération effective (« v<n>/size_480x320,q_72.webp ») :
 * le fichier est conservé, rien n'est régénéré. Ligne orpheline (version périmée, média non image)
 * ou déjà reprise par une autre instance : supprimée avec son fichier. Tâche de fond par lots, sans
 * effet quand tout est à jour.
 */
const BATCH = 200

async function migrateLegacyVariants(): Promise<number> {
  const prisma = await usePrisma()
  const storage = await useMediaStorage()
  const { maxDimension } = useTransformSettings()
  const preview = previewRequest()
  let migrated = 0
  for (;;) {
    // Les identifiants de la phase C contiennent toujours le format (« .webp ») ; les anciens, jamais.
    const batch = await prisma.mediaVariant.findMany({
      where: { NOT: { transformation: { contains: '.' } } },
      include: { media: true },
      take: BATCH,
    })
    for (const variant of batch) {
      const { media } = variant
      const source = transformSource(media)
      const planned = source && variant.transformation === `v${media.version}/preview`
        ? planTransform(preview.transformation, source, preview.format, maxDimension)
        : null
      if (planned?.ok) {
        try {
          await prisma.mediaVariant.update({
            where: { id: variant.id },
            data: { transformation: `v${media.version}/${planned.plan.key}` },
          })
          migrated++
          continue
        }
        catch (error) {
          if (!isUniqueViolation(error)) throw error
        }
      }
      await prisma.mediaVariant.delete({ where: { id: variant.id } })
      await storage.delete(variant.storageKey)
    }
    if (batch.length < BATCH) break
  }
  return migrated
}

export default defineNitroPlugin(() => {
  void migrateLegacyVariants()
    .then((count) => {
      if (count > 0) console.info(`[surge-media] Transformations : ${count} aperçu(s) repris.`)
    })
    .catch(error => console.error('[surge-media] Reprise des aperçus impossible :', error))
})
