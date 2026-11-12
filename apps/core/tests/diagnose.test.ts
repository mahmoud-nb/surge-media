import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranslator } from '../cli/i18n'
import { displayVariable, healthUrl } from '../cli/lib/diagnose/collect'
import { computeFindings, SESSION_PASSWORD_MIN_LENGTH } from '../cli/lib/diagnose/findings'
import { anonymizeHost, maskConnectionUrl, redactLines } from '../cli/lib/diagnose/redact'
import { renderJson, renderMarkdown } from '../cli/lib/diagnose/render'
import type { DatabaseInfo, DiagnoseReport } from '../cli/lib/diagnose/report'
import { DIAGNOSE_VARIABLES, resolveVariables, unknownVariables, type ResolvedVariable } from '../cli/lib/diagnose/variables'

const ROOT = join(import.meta.dirname, '..')
const KNOWN = new Set(DIAGNOSE_VARIABLES.map(item => item.name))

/** Nom de variable d'environnement de Nuxt pour un chemin de runtimeConfig (`media.storage.s3.accessKeyId`). */
function envName(path: string[]): string {
  return `NUXT_${path.map(part => part.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()).join('_')}`
}

function leaves(value: unknown, path: string[] = []): string[][] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]))
  }
  return [path]
}

describe('liste blanche des variables du diagnostic', () => {
  it('classe chaque variable de .env.example', () => {
    const names = [...readFileSync(join(ROOT, '.env.example'), 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]!)
    expect(names.length).toBeGreaterThan(50)
    expect(names.filter(name => !KNOWN.has(name))).toEqual([])
  })

  it('classe chaque réglage de runtimeConfig', async () => {
    const globals = globalThis as { defineNuxtConfig?: (config: unknown) => unknown }
    globals.defineNuxtConfig = config => config
    const config = (await import('../nuxt.config')).default as { runtimeConfig: Record<string, unknown> }
    const names = leaves(config.runtimeConfig).map(envName)
    expect(names).toContain('NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID')
    expect(names.filter(name => !KNOWN.has(name))).toEqual([])
  })

  it('ne déclare aucune variable deux fois', () => {
    expect(KNOWN.size).toBe(DIAGNOSE_VARIABLES.length)
  })
})

describe('valeurs et sources', () => {
  const files: Record<string, string> = { '/run/secrets/db': 'postgresql://u:p@db/x\n', '/data/secrets/NUXT_MFA_ENCRYPTION_KEY': 'generated-key' }
  const resolve = (env: Record<string, string>, dotenv: Record<string, string> = {}) => resolveVariables({
    env,
    dotenv,
    secretsDir: '/data/secrets',
    readFile: path => files[path.replaceAll('\\', '/')] ?? null,
  })
  const find = (list: ResolvedVariable[], name: string) => list.find(item => item.name === name)!

  it('suit l\'ordre du serveur : environnement, fichier, secret de l\'image, .env, défaut', () => {
    const list = resolve({ NUXT_SITE_URL: 'https://env.example', DATABASE_URL_FILE: '/run/secrets/db', PORT: '' }, { NUXT_SITE_URL: 'https://dotenv.example', PORT: '4000', NUXT_VIDEO_CRF: '20' })
    expect(find(list, 'NUXT_SITE_URL')).toMatchObject({ source: 'env', value: 'https://env.example' })
    expect(find(list, 'DATABASE_URL')).toMatchObject({ source: 'file', value: 'postgresql://u:p@db/x' })
    expect(find(list, 'NUXT_MFA_ENCRYPTION_KEY')).toMatchObject({ source: 'secrets-dir', value: 'generated-key' })
    expect(find(list, 'PORT')).toMatchObject({ source: 'dotenv', value: '4000' })
    expect(find(list, 'NUXT_SMTP_HOST')).toMatchObject({ source: 'default', value: null })
  })

  it('montre une valeur selon sa classe, jamais un secret ni une donnée personnelle', () => {
    const list = resolve({
      NUXT_SESSION_PASSWORD: 'session-secret-value-0123456789abcdef',
      NUXT_SMTP_FROM: 'Jane <jane@example.com>',
      NUXT_DEMO_ACCOUNTS: '[{"email":"a@b.c","password":"pw-demo-123"},{"email":"d@e.f","password":"pw-demo-456"}]',
      DATABASE_URL: 'postgresql://surge:db-password@db.internal:5432/media?sslpassword=tls-secret',
      NUXT_VIDEO_CRF: '20',
    })
    const shown = list.map(item => displayVariable(item, false))
    const text = JSON.stringify(shown)
    for (const secret of ['session-secret-value', 'jane@example.com', 'pw-demo-123', 'db-password', 'tls-secret']) expect(text).not.toContain(secret)
    expect(shown.find(item => item.name === 'NUXT_SESSION_PASSWORD')).toMatchObject({ set: true, value: null, length: 37 })
    expect(shown.find(item => item.name === 'NUXT_DEMO_ACCOUNTS')).toMatchObject({ set: true, count: 2 })
    expect(shown.find(item => item.name === 'DATABASE_URL')?.value).toBe('postgresql://surge:****@db.internal:5432/media?sslpassword=****')
    expect(shown.find(item => item.name === 'NUXT_VIDEO_CRF')?.value).toBe('20')
    const anonymized = list.map(item => displayVariable(item, true))
    expect(anonymized.find(item => item.name === 'DATABASE_URL')?.value).toBe('postgresql://…')
  })

  it('signale les variables inconnues avec le nom le plus proche', () => {
    const unknown = unknownVariables({
      env: { NUXT_SMTP_HOTS: 'x', NUXT_SESSION_PASSWORD_FILE: '/run/secrets/s', SURGE_MEDIA_IMAGE: 'img', PATH: '/bin' },
      dotenv: { NUXT_COMPLETELY_UNRELATED_SETTING: '1' },
    })
    expect(unknown).toEqual([
      { name: 'NUXT_COMPLETELY_UNRELATED_SETTING', source: 'dotenv', suggestion: null },
      { name: 'NUXT_SMTP_HOTS', source: 'env', suggestion: 'NUXT_SMTP_HOST' },
    ])
  })
})

describe('masquage', () => {
  it('masque mot de passe et paramètres sensibles d\'une URL', () => {
    expect(maskConnectionUrl('mysql://root:s3cret@db:3306/surge')).toBe('mysql://root:****@db:3306/surge')
    expect(maskConnectionUrl('postgresql://db/x?sslmode=require&token=abc')).toBe('postgresql://db/x?sslmode=require&token=****')
    expect(maskConnectionUrl('file:./data/surge-media.db')).toBe('file:./data/surge-media.db')
    expect(maskConnectionUrl('smtp.example.com')).toBe('smtp.example.com')
  })

  it('anonymise un hôte en gardant le schéma', () => {
    expect(anonymizeHost('https://media.example.com/base')).toBe('https://…')
    expect(anonymizeHost('my-bucket')).toBe('…')
    expect(anonymizeHost('file:./data/surge-media.db')).toBe('file:./data/surge-media.db')
  })

  it('caviarde un journal', () => {
    const { lines, redactions } = redactLines([
      '2026-11-06T17:09:56.123Z GET /m/abc/v1/w_800/photo.webp?exp=1793041280&sig=deadbeef 200',
      'login jane.doe@example.com from 203.0.113.42 and 2001:db8:85a3::8a2e:370:7334',
      'Authorization: Bearer abc.def.ghi key sm_sk_1234567890abcdef',
      'connect postgresql://surge:hunter2-password@db:5432/x failed',
      'cookie surge-media-session=Fe26.2**xyz; secret value session-secret-value-0123456789abcdef',
      'version 1.2.3 at 17:09:56',
    ], [{ name: 'NUXT_SESSION_PASSWORD', value: 'session-secret-value-0123456789abcdef' }, { name: 'SHORT', value: 'abc' }])
    const text = lines.join('\n')
    for (const leaked of ['deadbeef', '1793041280', 'jane.doe@example.com', '203.0.113.42', '2001:db8', 'abc.def.ghi', 'sm_sk_1234', 'hunter2', 'Fe26.2', 'session-secret-value']) {
      expect(text).not.toContain(leaked)
    }
    expect(text).toContain('[NUXT_SESSION_PASSWORD]')
    expect(text).toContain('2026-11-06T17:09:56.123Z')
    expect(lines[5]).toBe('version 1.2.3 at 17:09:56')
    expect(redactions).toBeGreaterThanOrEqual(10)
  })
})

function sampleReport(overrides: Partial<DiagnoseReport> = {}): Omit<DiagnoseReport, 'findings'> {
  return {
    format: 1,
    generatedAt: '2026-11-06T12:00:00.000Z',
    version: '0.1.0',
    options: { anonymize: false, server: true, log: false },
    instanceId: '7a1502a2-0b09-4d93-babf-7eb52b46ecdd',
    demo: false,
    system: { install: 'package', node: 'v24.20.0', nodeRequired: 24, platform: 'linux', release: '6.8', arch: 'x64', cpus: 4, memory: { total: 8 * 1024 ** 3, free: 4 * 1024 ** 3 }, container: false, disks: [{ role: 'instance', path: '/opt/surge-media', free: 50 * 1024 ** 3, total: 100 * 1024 ** 3 }] },
    configuration: { variables: [], unknown: [] },
    database: { ok: true, data: { provider: 'sqlite', url: 'file:./data/surge-media.db', serverVersion: 'SQLite 3.50.0', latencyMs: 0.2, migrations: { available: 18, applied: 18, pending: [], failed: [], unknown: [] }, counts: { users: 2, activeUsers: 2, admins: 1, projects: 1, archivedProjects: 0, media: { IMAGE: 3 }, mediaSize: 3000, trash: 0, variants: 2, variantsSize: 400, renditions: 0, renditionsSize: 0, auditEvents: 12 }, sqlite: { size: 4096, journalMode: 'wal' } } },
    storage: { driver: 'local', prefix: null, local: { path: '/opt/surge-media/data/media', exists: true, writable: true, creatable: false }, s3: null },
    processing: { sharp: { version: '0.35.5', vips: '8.18.7', error: null }, ffmpeg: { path: 'ffmpeg', version: '7.1', error: null }, ffprobe: { path: 'ffprobe', version: '7.1', error: null }, videoMode: 'off', workers: 0 },
    mail: { configured: false, host: null, port: '587', secure: false, user: false, password: false, from: false },
    license: { ok: true, data: { source: null, state: 'none', reason: null, id: null, licensee: null, plan: null, features: [], instances: null, startsAt: null, expiresAt: null, supportEndsAt: null, usage: { usage: 'community', declaredAt: '2026-11-06T10:00:00.000Z' } } },
    server: { url: 'http://127.0.0.1:3000/api/health', reachable: true, httpStatus: 200, status: 'ok', checks: { database: 'ok', storage: 'ok', imageProcessing: 'ok' }, videoProcessing: { mode: 'off', workers: null, queued: null }, error: null },
    logs: { jobs: {}, failedLastDay: 0, failed: [], pressure: null, file: null },
    ...overrides,
  }
}

function healthyDatabase(): DatabaseInfo {
  const { database } = sampleReport()
  if (!database.ok) throw new Error('fixture')
  return database.data
}

const SECRETS = resolveVariables({
  env: { NUXT_SESSION_PASSWORD: 'x'.repeat(40), NUXT_MEDIA_SIGNING_SECRET: 'y'.repeat(40), NUXT_MFA_ENCRYPTION_KEY: 'z'.repeat(43), NUXT_SITE_URL: 'https://media.example.com' },
  dotenv: {},
  secretsDir: null,
})
const codes = (report: Omit<DiagnoseReport, 'findings'>, variables = SECRETS) => computeFindings(report, variables, Date.parse('2026-11-06T12:00:00Z')).map(finding => finding.code)

describe('points d\'attention', () => {
  it('ne signale rien sur une installation saine', () => {
    expect(codes(sampleReport())).toEqual([])
  })

  it('signale les problèmes, erreurs d\'abord', () => {
    const variables = resolveVariables({ env: { NUXT_SESSION_PASSWORD: 'short', NUXT_BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com' }, dotenv: {}, secretsDir: null })
    const report = sampleReport({
      system: { ...sampleReport().system, node: 'v22.11.0', disks: [{ role: 'tmp', path: '/tmp', free: 100, total: 1000 }] },
      database: { ok: true, data: { ...healthyDatabase(), migrations: { available: 19, applied: 18, pending: ['20261106_next'], failed: [], unknown: [] } } },
      processing: { ...sampleReport().processing, videoMode: 'embedded', ffmpeg: { path: 'ffmpeg', version: null, error: 'ENOENT' } },
      server: { url: 'http://127.0.0.1:3000/api/health', reachable: true, httpStatus: 503, status: 'error', checks: { database: 'ok', storage: 'error' }, videoProcessing: null, error: null },
      logs: { jobs: { failed: 3 }, failedLastDay: 2, failed: [], pressure: null, file: null },
    })
    const found = codes(report, variables)
    expect(found).toEqual([
      'nodeVersion',
      'secretMissing',
      'sessionPasswordShort',
      'migrationsPending',
      'toolMissing',
      'serverUnhealthy',
      'lowDiskSpace',
      'mfaKeyMissing',
      'siteUrlMissing',
      'bootstrapSet',
      'failedJobs',
    ])
    expect(computeFindings(report, variables).find(finding => finding.code === 'sessionPasswordShort')?.params).toEqual({ length: 5, min: SESSION_PASSWORD_MIN_LENGTH })
  })

  it('distingue un dossier de stockage à créer d\'un dossier impossible à créer, et liste les réglages S3 manquants', () => {
    const local = (creatable: boolean) => sampleReport({ storage: { driver: 'local', prefix: null, local: { path: '/data/media', exists: false, writable: false, creatable }, s3: null } })
    expect(computeFindings(local(true), SECRETS).map(finding => [finding.level, finding.code])).toEqual([['info', 'storageNotCreated']])
    expect(computeFindings(local(false), SECRETS).map(finding => [finding.level, finding.code])).toEqual([['error', 'storageMissing']])
    const s3 = sampleReport({ storage: { driver: 's3', prefix: null, local: null, s3: { endpoint: null, region: 'eu-west-3', bucket: null, forcePathStyle: false, accessKey: true, secretKey: false } } })
    expect(computeFindings(s3, SECRETS)).toEqual([{ level: 'error', code: 's3Incomplete', params: { names: 'NUXT_MEDIA_STORAGE_S3_BUCKET, NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY' } }])
  })

  it('rappelle la licence et l\'usage, sauf en démo', () => {
    const license = { ...(sampleReport().license as { ok: true, data: never }).data as object, usage: null, state: 'expired', expiresAt: '2026-09-01T00:00:00.000Z' }
    expect(codes(sampleReport({ license: { ok: true, data: license as never } }))).toEqual(['license_expired', 'usageUndeclared'])
    expect(codes(sampleReport({ demo: true, license: { ok: true, data: { ...license, state: 'none' } as never } }))).toEqual(['demoMode'])
  })
})

describe('rendu du rapport', () => {
  const t = createTranslator('fr')
  const variables = resolveVariables({ env: { NUXT_SESSION_PASSWORD: 'session-secret-value-0123456789abcdef', NUXT_SITE_URL: 'https://media.example.com', NUXT_SMTP_USER: 'mailer@example.com' }, dotenv: {}, secretsDir: null })
  const partial = sampleReport({ configuration: { variables: variables.map(item => displayVariable(item, false)), unknown: [{ name: 'NUXT_SMTP_HOTS', source: 'env', suggestion: 'NUXT_SMTP_HOST' }] } })
  const report: DiagnoseReport = { ...partial, findings: computeFindings(partial, variables) }

  it('produit un Markdown lisible sans secret', () => {
    const markdown = renderMarkdown(report, t, 'fr')
    expect(markdown).toContain('# Rapport de diagnostic SurgeMedia')
    expect(markdown).toContain('## Points d\'attention')
    expect(markdown).toContain('| `NUXT_SESSION_PASSWORD` | défini (37 caractères) | environnement |')
    expect(markdown).toContain('| `NUXT_SMTP_USER` | défini | environnement |')
    expect(markdown).toContain('faute de frappe pour `NUXT_SMTP_HOST` ?')
    for (const secret of ['session-secret-value', 'mailer@example.com']) expect(markdown).not.toContain(secret)
  })

  it('produit un JSON sans secret', () => {
    const json = renderJson(report)
    expect(JSON.parse(json).format).toBe(1)
    for (const secret of ['session-secret-value', 'mailer@example.com']) expect(json).not.toContain(secret)
  })

  it('a les mêmes messages en anglais', () => {
    const markdown = renderMarkdown(report, createTranslator('en'), 'en')
    expect(markdown).toContain('# SurgeMedia diagnostic report')
    expect(markdown).toContain('set (37 characters)')
  })
})

describe('sonde locale', () => {
  it('vise la boucle locale sauf adresse d\'écoute précise', () => {
    expect(healthUrl(null, null)).toBe('http://127.0.0.1:3000/api/health')
    expect(healthUrl('3200', '0.0.0.0')).toBe('http://127.0.0.1:3200/api/health')
    expect(healthUrl('3200', '10.0.0.5')).toBe('http://10.0.0.5:3200/api/health')
    expect(healthUrl('3200', 'fd00::5')).toBe('http://[fd00::5]:3200/api/health')
  })
})
