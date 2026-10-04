/**
 * GET /api/auth/trusted-devices — appareils de confiance du compte connecté : durée configurée
 * (`days`, 0 = option désactivée), confiance de ce navigateur (`current`) et nombre d'appareils encore
 * valables (`total`, celui-ci compris).
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  return trustedDeviceState(event, user)
})
