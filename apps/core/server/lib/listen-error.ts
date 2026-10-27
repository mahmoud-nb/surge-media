/**
 * Message d'un échec d'écoute du serveur (port déjà utilisé, interdit, hôte invalide), `undefined` pour toute
 * autre erreur. Utilisé par server/plugins/listen-error.ts ; la CLI a ses propres messages traduits.
 */
export function listenErrorMessage(error: unknown, worker: boolean): string | undefined {
  const failure = error as NodeJS.ErrnoException & { port?: number, address?: string } | null
  if (!failure || typeof failure !== 'object' || failure.syscall !== 'listen') return undefined
  const port = failure.port ?? '?'
  if (failure.code === 'EADDRINUSE') {
    return `[surge-media] Port ${port} déjà utilisé (autre application, ou surgeMedia déjà lancé) : arrêt. `
      + `Libérez-le ou choisissez un autre port : variable PORT ; avec la CLI, --port${worker ? ' ou WORKER_PORT' : ''} ; `
      + 'avec Docker, changez le port publié (ex. -p 127.0.0.1:8080:3000, ou SURGE_MEDIA_PORT avec Compose).'
  }
  if (failure.code === 'EACCES') {
    return `[surge-media] Port ${port} interdit sans droits d'administrateur (ports inférieurs à 1024 sous Linux et `
      + 'macOS) : arrêt. Choisissez un port à partir de 1024, derrière un mandataire inverse pour les ports 80 et 443.'
  }
  const address = failure.address ? `${failure.address}:${port}` : `le port ${port}`
  return `[surge-media] Écoute impossible sur ${address} (${failure.code ?? failure.message}) : arrêt. `
    + 'Vérifiez HOST (ou NITRO_HOST) et PORT.'
}
