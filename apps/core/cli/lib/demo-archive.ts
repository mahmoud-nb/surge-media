import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DEMO_SNAPSHOT_DATABASE, DEMO_SNAPSHOT_FORMAT, DEMO_SNAPSHOT_MANIFEST } from '../../shared/utils/demo'

/**
 * Archive d'un instantané de démo (`surge-media demo snapshot` / `restore`, architecture démo § 4 et § 5) :
 * `tar.gz` qui contient le fichier descriptif, la copie de la base SQLite et le dossier des médias (sous le
 * nom de dossier de l'installation, noté dans le descriptif). Les secrets n'y sont jamais.
 */

export interface DemoManifest {
  format: number
  /** Date de la capture (ISO 8601). */
  createdAt: string
  /** Contenu de référence : créé au plus tard à cette date (ms Unix), copiée dans le réglage `demoReferenceAt`. */
  referenceAt: number
  /** Version du core qui a capturé l'instantané (les migrations mettent à niveau une base plus ancienne). */
  coreVersion: string
  /** Nom du dossier des médias dans l'archive. */
  media: string
}

/** Nom de dossier admis dans l'archive : un seul segment, sans chemin ni nom réservé. */
export function safeArchiveName(name: string): boolean {
  return /^[\w.-]{1,255}$/.test(name) && name !== '.' && name !== '..' && name !== DEMO_SNAPSHOT_DATABASE && name !== DEMO_SNAPSHOT_MANIFEST
}

/** Fichier descriptif lu dans une archive → descriptif valable, ou null. */
export function parseDemoManifest(text: string): DemoManifest | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  }
  catch {
    return null
  }
  const manifest = value as Partial<DemoManifest> | null
  if (!manifest || manifest.format !== DEMO_SNAPSHOT_FORMAT) return null
  if (typeof manifest.referenceAt !== 'number' || !Number.isFinite(manifest.referenceAt) || manifest.referenceAt <= 0) return null
  if (typeof manifest.createdAt !== 'string' || typeof manifest.coreVersion !== 'string') return null
  if (typeof manifest.media !== 'string' || !safeArchiveName(manifest.media)) return null
  return manifest as DemoManifest
}

/**
 * Outil `tar` du système : sous Windows, celui de Windows (bsdtar), jamais celui de Git Bash qui prend
 * « C: » pour un hôte distant ; ailleurs, celui du PATH (GNU tar dans l'image Docker).
 */
export function tarExecutable(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform !== 'win32') return 'tar'
  const system = join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'tar.exe')
  return existsSync(system) ? system : 'tar'
}

/** Lance `tar` avec ces arguments ; erreur avec sa sortie d'erreur s'il échoue. */
export function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tarExecutable(), args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `tar: code ${code}`))))
  })
}

/** Déplace un fichier ou un dossier ; copie puis suppression s'ils sont sur deux disques (EXDEV). */
export async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await cp(from, to, { recursive: true })
    await rm(from, { recursive: true, force: true })
  }
}
