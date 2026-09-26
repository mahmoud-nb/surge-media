type CheckStatus = 'ok' | 'error'

async function probe(check: () => unknown): Promise<CheckStatus> {
  try {
    await check()
    return 'ok'
  }
  catch {
    return 'error'
  }
}

/**
 * Sonde de santé (Docker, orchestrateur, supervision) : 200 si tout répond, 503 sinon.
 * Ne renvoie que des statuts, jamais de détail d'erreur ni de version.
 */
export default defineEventHandler(async (event) => {
  const checks = {
    database: await probe(async () => (await usePrisma()).$queryRaw`SELECT 1`),
    storage: await probe(() => useStorage(MEDIA_STORAGE).hasItem('.healthcheck')),
    // Import dynamique : un binaire sharp absent ou incompatible est signalé sans faire tomber la route.
    imageProcessing: await probe(async () => (await import('sharp')).default.versions.vips),
  }
  const healthy = Object.values(checks).every(status => status === 'ok')

  setResponseStatus(event, healthy ? 200 : 503)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { status: healthy ? 'ok' : 'error', checks }
})
