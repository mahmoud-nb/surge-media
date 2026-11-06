/**
 * Masquage pour `surge-media diagnose` (.claude/architecture-diagnose.md, DG1, DG4, DG7) : URL de connexion
 * (identifiants, paramètres sensibles), anonymisation des hôtes, caviardage d'un journal exporté. Fonctions
 * pures, testées (tests/diagnose.test.ts). Le caviardage est un filet de sécurité : le rapport demande
 * toujours de relire avant d'envoyer.
 */

export const MASK = '****'
const SENSITIVE_PARAM = /pass|secret|token|key|sig|auth|credential/i

/**
 * URL affichable : mot de passe et paramètres sensibles masqués (`?sslpassword=…`, `?token=…`). Une valeur qui
 * n'est pas une URL (`file:./data/surge-media.db`, liste d'adresses) est rendue telle quelle.
 */
export function maskConnectionUrl(value: string): string {
  if (value.startsWith('file:')) return value
  let parsed: URL
  try {
    parsed = new URL(value)
  }
  catch {
    return value
  }
  if (!parsed.host) return value
  const sensitive = [...parsed.searchParams.keys()].filter(name => SENSITIVE_PARAM.test(name))
  // Rien à masquer : la valeur reste telle qu'écrite (URL.toString() ajouterait par exemple une barre finale).
  if (!parsed.password && !sensitive.length) return value
  if (parsed.password) parsed.password = MASK
  for (const name of sensitive) parsed.searchParams.set(name, MASK)
  return parsed.toString()
}

/**
 * Valeur d'hôte anonymisée (`--anonymize`) : seul le schéma d'une URL reste (`https://…`), le chemin d'une
 * base SQLite aussi (il ne désigne pas de machine) ; toute autre valeur devient « … ».
 */
export function anonymizeHost(value: string): string {
  if (value.startsWith('file:')) return value
  const scheme = /^([a-z][a-z0-9+.-]*:)\/\//i.exec(value)
  return scheme ? `${scheme[1]}//…` : '…'
}

// ─── Journal exporté ────────────────────────────────────────────────────────────

/** Valeurs connues à retirer d'un journal : secrets et données personnelles lus dans la configuration. */
export interface KnownValue {
  name: string
  value: string
}

/** En deçà, une valeur est trop commune pour être cherchée telle quelle (« true », « 587 »…). */
export const KNOWN_VALUE_MIN_LENGTH = 6

interface Rule {
  pattern: RegExp
  replace: string | ((match: string, ...groups: string[]) => string)
}

const RULES: Rule[] = [
  // Identifiants dans une URL : schéma://utilisateur:mot-de-passe@hôte
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, replace: `$1${MASK}@` },
  // En-tête d'autorisation
  { pattern: /\b(Bearer|Basic)\s+[\w.~+/=-]+/g, replace: `$1 ${MASK}` },
  // Clés et jetons de surgeMedia (publiques, secrètes, personnelles, délégués)
  { pattern: /\bsm_(?:sk|pk|pat|dt)_[\w-]+/g, replace: `sm_${MASK}` },
  // Paramètres sensibles d'une URL (liens signés, jetons)
  { pattern: /([?&](?:sig|signature|token|key|exp|code)=)[^&\s"']+/gi, replace: `$1${MASK}` },
  // Cookies de session et d'appareil de confiance
  { pattern: /\b(surge-media-[\w-]+=)[^;\s"']+/g, replace: `$1${MASK}` },
  // Adresses e-mail
  { pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, replace: '[e-mail]' },
  // Adresses IPv4 (y compris ::ffff:1.2.3.4)
  { pattern: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, replace: '[IP]' },
  // Adresses IPv6 : cinq groupes au moins (une heure « 17:09:56 » n'en a que trois), ou forme abrégée « fe80::1 »
  { pattern: /\b(?:[\da-f]{1,4}:){4,7}[\da-f]{1,4}\b|\b(?:[\da-f]{1,4}:){1,6}:[\da-f]{1,4}\b/gi, replace: '[IP]' },
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Caviarde des lignes de journal : valeurs connues d'abord (`[NUXT_SESSION_PASSWORD]`), puis les motifs ci-dessus.
 * Rend les lignes et le nombre de remplacements.
 */
export function redactLines(lines: readonly string[], known: readonly KnownValue[]): { lines: string[], redactions: number } {
  const values = known
    .filter(item => item.value.length >= KNOWN_VALUE_MIN_LENGTH)
    // Les plus longues d'abord : une valeur contenue dans une autre ne laisse pas de reste.
    .sort((a, b) => b.value.length - a.value.length)
    .map(item => ({ pattern: new RegExp(escapeRegExp(item.value), 'g'), replace: `[${item.name}]` }))
  let redactions = 0
  const result = lines.map((line) => {
    let text = line
    for (const rule of [...values, ...RULES]) {
      text = text.replace(rule.pattern, (...args: string[]) => {
        redactions++
        const groups = args.slice(1, -2)
        return typeof rule.replace === 'function'
          ? rule.replace(args[0]!, ...groups)
          : rule.replace.replace(/\$(\d)/g, (_, index: string) => groups[Number(index) - 1] ?? '')
      })
    }
    return text
  })
  return { lines: result, redactions }
}
