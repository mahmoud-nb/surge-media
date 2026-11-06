import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Variables de l'installation pour `surge-media diagnose` (.claude/architecture-diagnose.md, DG1 à DG3) : liste
 * blanche classée, source de chaque valeur, variables inconnues. Le rapport n'affiche une valeur que si sa
 * classe le permet ; tests/diagnose.test.ts oblige à classer toute variable de `.env.example` et de
 * `runtimeConfig`.
 *
 *   - `shown` : valeur affichée telle quelle ;
 *   - `host` : valeur affichée (identifiants d'une URL masqués), remplacée avec `--anonymize` ;
 *   - `secret` : « défini, N caractères », jamais la valeur ;
 *   - `personal` : « défini » (e-mail, nom, adresse, téléphone) ;
 *   - `count` : nombre d'éléments d'une liste JSON (comptes de la démo, mots de passe compris).
 */
export type VariableKind = 'shown' | 'host' | 'secret' | 'personal' | 'count'

export const VARIABLE_GROUPS = ['install', 'database', 'secrets', 'storage', 'media', 'video', 'api', 'mail', 'license', 'demo', 'docker'] as const
export type VariableGroup = (typeof VARIABLE_GROUPS)[number]

export interface VariableSpec {
  name: string
  kind: VariableKind
  group: VariableGroup
}

const spec = (group: VariableGroup, kind: VariableKind, names: string[]): VariableSpec[] =>
  names.map(name => ({ name, kind, group }))

export const DIAGNOSE_VARIABLES: readonly VariableSpec[] = [
  ...spec('install', 'host', ['NUXT_SITE_URL', 'NUXT_TRUST_PROXY']),
  ...spec('install', 'shown', ['PORT', 'HOST', 'NITRO_HOST', 'WORKER_PORT', 'NUXT_SERVER_ROLE', 'NODE_ENV', 'NODE_OPTIONS', 'TMPDIR', 'SURGE_MEDIA_LANG', 'NUXT_SESSION_NAME', 'NUXT_SESSION_MAX_AGE', 'NUXT_SESSION_COOKIE_SAME_SITE', 'NUXT_SESSION_COOKIE_SECURE', 'NUXT_PUBLIC_TRUSTED_DEVICE_DAYS']),
  ...spec('install', 'personal', ['NUXT_BOOTSTRAP_ADMIN_EMAIL']),
  ...spec('install', 'secret', ['NUXT_BOOTSTRAP_ADMIN_PASSWORD']),
  ...spec('database', 'shown', ['DATABASE_PROVIDER']),
  ...spec('database', 'host', ['DATABASE_URL']),
  ...spec('secrets', 'secret', ['NUXT_SESSION_PASSWORD', 'NUXT_MEDIA_SIGNING_SECRET', 'NUXT_MEDIA_PREVIOUS_SIGNING_SECRET', 'NUXT_MFA_ENCRYPTION_KEY']),
  ...spec('storage', 'shown', ['NUXT_MEDIA_STORAGE_DRIVER', 'NUXT_MEDIA_STORAGE_ROOT', 'NUXT_MEDIA_STORAGE_PREFIX', 'NUXT_MEDIA_STORAGE_S3_REGION', 'NUXT_MEDIA_STORAGE_S3_FORCE_PATH_STYLE']),
  ...spec('storage', 'host', ['NUXT_MEDIA_STORAGE_S3_ENDPOINT', 'NUXT_MEDIA_STORAGE_S3_BUCKET', 'NUXT_MEDIA_PUBLIC_URL']),
  ...spec('storage', 'secret', ['NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID', 'NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY']),
  ...spec('media', 'shown', ['NUXT_MEDIA_MAX_UPLOAD_SIZE', 'NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE', 'NUXT_MEDIA_UPLOAD_TIMEOUT', 'NUXT_MEDIA_VIDEO_PREPARE', 'NUXT_MEDIA_PROCESSING_CONCURRENCY', 'NUXT_MEDIA_PROCESSING_QUEUE', 'NUXT_MEDIA_TRANSFORM_MAX_DIMENSION', 'NUXT_MEDIA_TRANSFORM_FORMATS', 'NUXT_MEDIA_TRANSFORM_MAX_VARIANTS', 'NUXT_MEDIA_TRANSFORM_RATE_LIMIT', 'NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE']),
  ...spec('video', 'shown', ['NUXT_VIDEO_PROCESSING', 'NUXT_VIDEO_CONCURRENCY', 'NUXT_VIDEO_THREADS', 'NUXT_VIDEO_RENDITION', 'NUXT_VIDEO_PRESET', 'NUXT_VIDEO_CRF', 'NUXT_VIDEO_AV1', 'NUXT_VIDEO_MAX_DURATION', 'NUXT_VIDEO_MEMORY_LIMIT', 'NUXT_FFMPEG_PATH', 'NUXT_FFPROBE_PATH']),
  ...spec('api', 'shown', ['NUXT_API_RATE_LIMIT_PUBLISHABLE', 'NUXT_API_RATE_LIMIT_SECRET', 'NUXT_API_RATE_LIMIT_PERSONAL', 'NUXT_API_RATE_LIMIT_DELEGATED', 'NUXT_API_RATE_LIMIT_UPLOADS', 'NUXT_API_RATE_LIMIT_AUTH_FAILURES']),
  ...spec('mail', 'host', ['NUXT_SMTP_HOST']),
  ...spec('mail', 'shown', ['NUXT_SMTP_PORT', 'NUXT_SMTP_SECURE']),
  ...spec('mail', 'personal', ['NUXT_SMTP_USER', 'NUXT_SMTP_FROM']),
  ...spec('mail', 'secret', ['NUXT_SMTP_PASSWORD']),
  ...spec('license', 'secret', ['NUXT_LICENSE_KEY']),
  ...spec('demo', 'shown', ['NUXT_DEMO_MODE', 'NUXT_DEMO_RESET_INTERVAL', 'NUXT_DEMO_UPLOAD_QUOTA', 'NUXT_DEMO_LEGAL_LOG_RETENTION_DAYS', 'SURGE_MEDIA_DEMO_SNAPSHOT']),
  ...spec('demo', 'count', ['NUXT_DEMO_ACCOUNTS']),
  ...spec('demo', 'personal', ['NUXT_DEMO_CONTACT_URL', 'NUXT_DEMO_ABUSE_URL', 'NUXT_DEMO_TERMS_URL', 'NUXT_DEMO_LEGAL_PUBLISHER_NAME', 'NUXT_DEMO_LEGAL_TRADE_NAME', 'NUXT_DEMO_LEGAL_REGISTRATION', 'NUXT_DEMO_LEGAL_ADDRESS', 'NUXT_DEMO_LEGAL_EMAIL', 'NUXT_DEMO_LEGAL_PHONE', 'NUXT_DEMO_LEGAL_DIRECTOR', 'NUXT_DEMO_LEGAL_HOST_NAME', 'NUXT_DEMO_LEGAL_HOST_ADDRESS', 'NUXT_DEMO_LEGAL_HOST_PHONE']),
  ...spec('docker', 'shown', ['SURGE_MEDIA_MIGRATE', 'SURGE_MEDIA_SECRETS_DIR']),
]

const BY_NAME = new Map(DIAGNOSE_VARIABLES.map(item => [item.name, item]))

/** Variables lisibles dans un fichier (secrets Docker, `NOM_FILE=/run/secrets/…`), comme docker/entrypoint.sh. */
export const FILE_VARIABLES = ['DATABASE_URL', 'NUXT_SESSION_PASSWORD', 'NUXT_MEDIA_SIGNING_SECRET', 'NUXT_MEDIA_PREVIOUS_SIGNING_SECRET', 'NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID', 'NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY', 'NUXT_SMTP_PASSWORD', 'NUXT_BOOTSTRAP_ADMIN_PASSWORD', 'NUXT_MFA_ENCRYPTION_KEY', 'NUXT_LICENSE_KEY'] as const
/** Secrets que l'image génère et garde dans son volume quand ils manquent (docker/entrypoint.sh, `ensure_secret`). */
export const GENERATED_SECRETS = ['NUXT_SESSION_PASSWORD', 'NUXT_MEDIA_SIGNING_SECRET', 'NUXT_MFA_ENCRYPTION_KEY'] as const

/** D'où vient une valeur : environnement, fichier `NOM_FILE`, secret gardé par l'image, `.env`, ou rien (valeur par défaut). */
export type VariableSource = 'env' | 'file' | 'secrets-dir' | 'dotenv' | 'default'

export interface ResolvedVariable {
  name: string
  kind: VariableKind
  group: VariableGroup
  source: VariableSource
  /** Valeur effective (jamais rendue telle quelle pour `secret`, `personal`, `count`) ; null si non définie. */
  value: string | null
}

export interface VariableInputs {
  env: Record<string, string | undefined>
  dotenv: Record<string, string | undefined>
  /** Dossier des secrets générés par l'image (`SURGE_MEDIA_SECRETS_DIR`, sinon `data/secrets`), s'il existe. */
  secretsDir?: string | null
  readFile?: (path: string) => string | null
}

function defaultReadFile(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  }
  catch {
    return null
  }
}

/** Valeur effective et source de chaque variable connue, dans l'ordre de la liste blanche. */
export function resolveVariables(inputs: VariableInputs): ResolvedVariable[] {
  const readFile = inputs.readFile ?? defaultReadFile
  return DIAGNOSE_VARIABLES.map(({ name, kind, group }) => {
    const base = { name, kind, group }
    const fromEnv = inputs.env[name]
    if (fromEnv !== undefined && fromEnv !== '') return { ...base, source: 'env', value: fromEnv }
    const file = (FILE_VARIABLES as readonly string[]).includes(name) ? inputs.env[`${name}_FILE`] : undefined
    if (file) {
      const content = readFile(file)
      if (content !== null) return { ...base, source: 'file', value: content.trim() }
    }
    if (inputs.secretsDir && (GENERATED_SECRETS as readonly string[]).includes(name)) {
      const content = readFile(join(inputs.secretsDir, name))
      if (content?.trim()) return { ...base, source: 'secrets-dir', value: content.trim() }
    }
    const fromDotenv = inputs.dotenv[name]
    if (fromDotenv !== undefined && fromDotenv !== '') return { ...base, source: 'dotenv', value: fromDotenv }
    return { ...base, source: 'default', value: null }
  })
}

/** Valeur effective d'une variable résolue (null si non définie). */
export function variableValue(variables: readonly ResolvedVariable[], name: string): string | null {
  return variables.find(item => item.name === name)?.value ?? null
}

// ─── Variables inconnues ────────────────────────────────────────────────────────

const PREFIXES = ['NUXT_', 'SURGE_MEDIA_']

/** Distance d'édition (Levenshtein), pour proposer le nom connu le plus proche. */
export function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]!
      previous[j] = Math.min(above + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return previous[b.length]!
}

export interface UnknownVariable {
  name: string
  source: 'env' | 'dotenv'
  /** Nom connu le plus proche (distance 3 au plus), s'il y en a un. */
  suggestion: string | null
}

/**
 * Variables `NUXT_*` et `SURGE_MEDIA_*` présentes mais inconnues : souvent une faute de frappe, donc un réglage
 * ignoré. Les `NOM_FILE` des secrets Docker et les variables propres à Nuxt ou Nitro ne sont pas signalées.
 */
export function unknownVariables(inputs: Pick<VariableInputs, 'env' | 'dotenv'>): UnknownVariable[] {
  const seen = new Map<string, 'env' | 'dotenv'>()
  for (const [source, values] of [['env', inputs.env], ['dotenv', inputs.dotenv]] as const) {
    for (const name of Object.keys(values)) {
      if (!PREFIXES.some(prefix => name.startsWith(prefix)) || BY_NAME.has(name) || seen.has(name)) continue
      if (name.endsWith('_FILE') && (FILE_VARIABLES as readonly string[]).includes(name.slice(0, -5))) continue
      if (IGNORED_UNKNOWN.has(name)) continue
      seen.set(name, source)
    }
  }
  return [...seen].map(([name, source]) => {
    let best: { name: string, distance: number } | null = null
    for (const known of DIAGNOSE_VARIABLES) {
      const distance = editDistance(name, known.name)
      if (distance <= 3 && (!best || distance < best.distance)) best = { name: known.name, distance }
    }
    return { name, source, suggestion: best?.name ?? null }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * À ne pas signaler : variables de Nuxt lui-même, et variables des fichiers Docker Compose fournis (lues par
 * Compose sur la machine hôte, jamais par surgeMedia).
 */
const IGNORED_UNKNOWN = new Set([
  'NUXT_TELEMETRY_DISABLED',
  'NUXT_APP_BASE_URL',
  'NUXT_APP_CDN_URL',
  'NUXT_APP_BUILD_ASSETS_DIR',
  'SURGE_MEDIA_IMAGE',
  'SURGE_MEDIA_PORT',
  'SURGE_MEDIA_PREPARE_PORT',
  'NUXT_PREPARE_SITE_URL',
])
