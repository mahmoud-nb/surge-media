import { BlockList, isIP } from 'node:net'

/**
 * Adresse IP réelle du client derrière un ou plusieurs mandataires inverses (Docker, nginx, Traefik, CDN), à partir
 * de `X-Forwarded-For` (fonctions pures, testées ; plugin `server/plugins/client-ip.ts`).
 *
 * Réglage `NUXT_TRUST_PROXY` (`trustedProxies`) :
 *   - `true` (défaut) : mandataires de confiance = boucle locale et réseaux privés (127.0.0.0/8, ::1, 10.0.0.0/8,
 *     172.16.0.0/12, 192.168.0.0/16, fc00::/7, liens locaux) — les réseaux de Docker ; même défaut que Rails ;
 *   - `false` : `X-Forwarded-For` ignoré, adresse de la connexion seulement ;
 *   - liste séparée par des virgules d'adresses, de plages CIDR et des mots `loopback` / `private`
 *     (ex. `private,203.0.113.10,2001:db8::/32`) : mandataire hors réseau privé, CDN.
 *
 * Lecture de **droite à gauche** (`resolveClientIp`) : chaque mandataire ajoute à droite l'adresse de celui qui
 * l'a contacté. On part de l'adresse de la connexion ; tant qu'elle appartient à un mandataire de confiance, on
 * passe à l'entrée précédente du `X-Forwarded-For`. La première adresse qui n'est pas un mandataire de confiance
 * est le client. Une entrée écrite par le client lui-même (à gauche) n'est donc jamais retenue à la place de la
 * sienne, et un client qui se connecte directement (adresse publique) ne peut rien usurper : l'en-tête est ignoré.
 * L'adresse la plus à gauche (choix de h3 avec `xForwardedFor: true`, ou de `trust proxy: true` d'Express) serait
 * usurpable dès que le mandataire ajoute à l'en-tête reçu au lieu de le remplacer, ce que font nginx
 * (`$proxy_add_x_forwarded_for`) et Traefik.
 */

/** Mandataire de confiance ? (adresse déjà normalisée). Null = `X-Forwarded-For` ignoré. */
export type TrustedProxies = (address: string) => boolean

/** Entrées examinées au plus (de droite à gauche) : un en-tête démesuré ne coûte rien de plus. */
export const MAX_FORWARDED_HOPS = 20

const RANGES: Record<'loopback' | 'private', readonly [string, number, 'ipv4' | 'ipv6'][]> = {
  loopback: [['127.0.0.0', 8, 'ipv4'], ['::1', 128, 'ipv6']],
  private: [
    ['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['169.254.0.0', 16, 'ipv4'],
    ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6'],
  ],
}

/**
 * Adresse IP normalisée d'une entrée de `X-Forwarded-For` ou d'une connexion : sans crochets ni port
 * (`[2001:db8::1]:443`, `203.0.113.7:51234`), sans zone (`fe80::1%eth0`), IPv4 au lieu de l'IPv6 « mappée »
 * (`::ffff:10.0.0.2`). Null si ce n'est pas une adresse IP.
 */
export function normalizeIp(value: string | undefined | null): string | null {
  if (!value) return null
  let address = value.trim()
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address)
  if (bracketed) address = bracketed[1]!
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(address)) address = address.slice(0, address.lastIndexOf(':'))
  address = address.replace(/%.*$/, '')
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  if (mapped) address = mapped[1]!
  return isIP(address) ? address.toLowerCase() : null
}

/**
 * Mandataires de confiance d'après le réglage (`true` / `false` / liste). Entrées invalides signalées par
 * `warn` et ignorées ; aucune entrée valide → null (en-tête ignoré : en cas de doute, ne pas faire confiance).
 */
export function trustedProxies(setting: unknown, warn: (message: string) => void = () => {}): TrustedProxies | null {
  const text = typeof setting === 'string' ? setting.trim().toLowerCase() : setting
  if (text === false || text === 'false' || text === '0' || text === 'off' || text === 'no') return null
  // Absent ou vide : le défaut (`true`).
  const tokens = text === true || text === undefined || text === null || text === '' || text === 'true' || text === '1' || text === 'on' || text === 'yes'
    ? ['loopback', 'private']
    : String(text).split(',').map(token => token.trim()).filter(Boolean)

  const list = new BlockList()
  let rules = 0
  for (const token of tokens) {
    if (token === 'loopback' || token === 'private') {
      for (const [network, prefix, type] of RANGES[token]) list.addSubnet(network, prefix, type)
      rules++
      continue
    }
    const [network, prefixText, extra] = token.split('/')
    const address = normalizeIp(network)
    const type = address && isIP(address) === 6 ? 'ipv6' : 'ipv4'
    const prefix = prefixText === undefined ? null : Number(prefixText)
    const valid = address !== null && extra === undefined
      && (prefix === null || (Number.isInteger(prefix) && prefix >= 0 && prefix <= (type === 'ipv6' ? 128 : 32)))
    if (!valid) {
      warn(`NUXT_TRUST_PROXY : « ${token} » n'est ni une adresse IP, ni une plage CIDR, ni loopback / private (ignoré).`)
      continue
    }
    if (prefix === null) list.addAddress(address!, type)
    else list.addSubnet(address!, prefix, type)
    rules++
  }
  if (rules === 0) return null
  return address => list.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')
}

/**
 * Adresse du client : celle de la connexion, ou, si la connexion vient d'un mandataire de confiance, la première
 * adresse de `X-Forwarded-For` (de droite à gauche) qui n'est pas un mandataire de confiance. Entrée illisible :
 * arrêt sur la dernière adresse sûre (celle du mandataire qui l'a transmise). Tous de confiance (client interne) :
 * la plus à gauche des adresses lues. Rend l'adresse de la connexion telle quelle si l'en-tête ne sert pas.
 */
export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | readonly string[] | undefined,
  trusted: TrustedProxies,
): string | undefined {
  const peer = normalizeIp(remoteAddress)
  if (!peer || !trusted(peer)) return remoteAddress
  const header = typeof forwardedFor === 'string' ? forwardedFor : forwardedFor?.join(',')
  if (!header) return remoteAddress
  let client = remoteAddress
  const hops = header.split(',').slice(-MAX_FORWARDED_HOPS)
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = normalizeIp(hops[index])
    if (!hop) break
    client = hop
    if (!trusted(hop)) break
  }
  return client
}
