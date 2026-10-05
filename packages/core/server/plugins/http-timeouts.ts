import type { Server } from 'node:http'

/**
 * Délai de réception des requêtes (architecture phase D, DD5). Node coupe toute requête non reçue en
 * entier en 300 s (`server.requestTimeout`) : un envoi de 512 Mio exigerait plus de 14 Mbit/s montants.
 * Le délai est porté à `NUXT_MEDIA_UPLOAD_TIMEOUT` (3600 s). Les autres garde-fous restent : en-têtes en
 * 60 s (`headersTimeout`, inchangé), corps JSON en 30 s (middleware body-limit), envois arrêtés après
 * 60 s sans donnée (upload.ts).
 *
 * Nitro ne donne pas accès au serveur HTTP : il est retrouvé par la socket de la première requête
 * (`socket.server`), et Node relit ce réglage à chaque contrôle des connexions. Appels internes (`$fetch`
 * pendant le rendu) : socket simulée sans serveur, ignorée. À revérifier avec Nitro 3.
 */
export default defineNitroPlugin((nitroApp) => {
  const seconds = Number(useRuntimeConfig().media.uploadTimeout)
  const timeout = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 3_600_000
  const adjusted = new WeakSet<Server>()

  nitroApp.hooks.hook('request', (event) => {
    const server = (event.node.req.socket as { server?: Server } | undefined)?.server
    if (!server || adjusted.has(server) || typeof server.requestTimeout !== 'number') return
    adjusted.add(server)
    // 0 = sans limite : un réglage plus permissif n'est jamais réduit.
    if (server.requestTimeout !== 0 && server.requestTimeout < timeout) server.requestTimeout = timeout
  })
})
