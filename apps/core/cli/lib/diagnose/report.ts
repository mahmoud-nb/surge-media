import type { LicenseState, LicenseUsageDeclaration } from '../../../shared/utils/license'
import type { UnknownVariable, VariableGroup, VariableKind, VariableSource } from './variables'

/**
 * Rapport de `surge-media diagnose` (.claude/architecture-diagnose.md § 3) : données brutes, sans secret ni
 * donnée personnelle, rendues en Markdown ou en JSON par render.ts. Chaque section tolère son propre échec
 * (`{ ok: false, error }`) : un rapport partiel vaut mieux que pas de rapport.
 */

export type Section<T> = { ok: true, data: T } | { ok: false, error: string }

export const REPORT_FORMAT = 1

export type InstallMode = 'source' | 'package' | 'docker-image'

/**
 * Variable telle que le rapport la montre : la valeur seulement pour `shown` et `host` (masquée ou anonymisée),
 * la longueur d'un secret, le nombre d'éléments d'une liste ; jamais rien d'autre (rendu JSON compris).
 */
export interface DisplayVariable {
  name: string
  group: VariableGroup
  kind: VariableKind
  source: VariableSource
  set: boolean
  value: string | null
  length: number | null
  count: number | null
}

export interface DiskSpace {
  /** Rôle du dossier : installation, stockage local, fichiers temporaires. */
  role: 'instance' | 'storage' | 'tmp'
  path: string
  /** Octets libres pour un utilisateur ordinaire, et taille du volume ; null si illisibles. */
  free: number | null
  total: number | null
}

export interface SystemInfo {
  install: InstallMode
  node: string
  /** Version majeure minimale (engines de package.json). */
  nodeRequired: number
  platform: string
  release: string
  arch: string
  cpus: number
  memory: { total: number, free: number }
  container: boolean
  disks: DiskSpace[]
}

export interface MigrationsInfo {
  /** Migrations du paquet pour ce fournisseur. */
  available: number
  applied: number
  /** Dans le paquet, pas encore appliquées. */
  pending: string[]
  /** Commencées sans finir (échec à corriger avant tout redémarrage). */
  failed: string[]
  /** Appliquées mais absentes du paquet : base plus récente que cette version. */
  unknown: string[]
}

export interface DatabaseInfo {
  provider: string
  url: string
  serverVersion: string | null
  latencyMs: number
  migrations: MigrationsInfo | null
  counts: {
    users: number
    activeUsers: number
    admins: number
    projects: number
    archivedProjects: number
    media: Record<string, number>
    mediaSize: number
    trash: number
    variants: number
    variantsSize: number
    renditions: number
    renditionsSize: number
    auditEvents: number
  } | null
  sqlite: { size: number | null, journalMode: string | null } | null
}

export interface StorageInfo {
  driver: string
  prefix: string | null
  /** `creatable` : dossier absent que le serveur pourra créer au démarrage (parent existant accessible en écriture). */
  local: { path: string, exists: boolean, writable: boolean, creatable: boolean } | null
  s3: { endpoint: string | null, region: string | null, bucket: string | null, forcePathStyle: boolean, accessKey: boolean, secretKey: boolean } | null
}

export interface ToolInfo {
  path: string
  version: string | null
  error: string | null
}

export interface ProcessingInfo {
  sharp: { version: string | null, vips: string | null, error: string | null }
  ffmpeg: ToolInfo
  ffprobe: ToolInfo
  videoMode: string
  /** Processus de travail vus dans les 5 dernières minutes (null si la base est injoignable). */
  workers: number | null
}

export interface MailInfo {
  configured: boolean
  host: string | null
  port: string
  secure: boolean
  user: boolean
  password: boolean
  from: boolean
}

export interface LicenseInfo {
  source: 'env' | 'database' | null
  state: LicenseState
  reason: string | null
  id: string | null
  licensee: string | null
  plan: string | null
  features: string[]
  instances: number | null
  startsAt: string | null
  expiresAt: string | null
  supportEndsAt: string | null
  usage: LicenseUsageDeclaration | null
}

export interface ServerInfo {
  url: string
  reachable: boolean
  httpStatus: number | null
  status: string | null
  checks: Record<string, string> | null
  videoProcessing: { mode: string | null, workers: number | null, queued: number | null } | null
  error: string | null
}

export interface FailedJob {
  at: string | null
  code: string | null
  detail: string | null
  attempts: number
}

export interface LogsInfo {
  jobs: Record<string, number> | null
  failedLastDay: number | null
  failed: FailedJob[]
  pressure: { level: string, at: string, busy: number, slow: number, loadedMinutes: number } | null
  file: { path: string, lines: string[], total: number, redactions: number } | null
}

export interface DiagnoseReport {
  format: typeof REPORT_FORMAT
  generatedAt: string
  version: string
  options: { anonymize: boolean, server: boolean, log: boolean }
  instanceId: string | null
  demo: boolean
  system: SystemInfo
  configuration: { variables: DisplayVariable[], unknown: UnknownVariable[] }
  database: Section<DatabaseInfo>
  storage: StorageInfo
  processing: ProcessingInfo
  mail: MailInfo
  license: Section<LicenseInfo>
  server: ServerInfo | null
  logs: LogsInfo
  findings: Finding[]
}

export type FindingLevel = 'error' | 'warning' | 'info'

/** Point d'attention : code traduit par le rendu (`diagnose.finding.<code>`), paramètres déjà sans secret. */
export interface Finding {
  level: FindingLevel
  code: string
  params?: Record<string, string | number>
}
