import { type ChildProcess, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { availableParallelism, setPriority } from 'node:os'
import { delimiter, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { truncateText, type VideoJobErrorCode } from '#shared/utils/video-processing'

/**
 * Lancement de ffmpeg et ffprobe (phase D3, architecture § 30.1 et § 36, DD25, DD35). Toujours un
 * processus enfant, jamais un shell (arguments en tableau, construits par args.ts), et toujours borné :
 *   - **priorité la plus basse** (`os.setPriority(pid, 19)`, IDLE_PRIORITY_CLASS sous Windows) : mesuré
 *     au § 29.3, un encodage en priorité normale triple le p99 du serveur web de la même machine ;
 *   - **délai** puis arrêt de l'**arbre de processus** (groupe POSIX tué d'un coup, `taskkill /T` sous
 *     Windows), aussi sur demande (`AbortSignal` : bail perdu, arrêt du serveur) ;
 *   - **mémoire et temps processeur** sous Linux, par `prlimit` quand l'outil existe : `--as` (un fichier
 *     hostile qui fait exploser les allocations échoue au lieu d'affamer la machine) et `--cpu` (voir plus bas) ;
 *   - **durée de sortie** (`maxOutputSeconds`, lue dans la progression) : un fichier dont la durée est
 *     inconnue ou fausse ne contourne pas NUXT_VIDEO_MAX_DURATION ;
 *   - **sorties bornées** : 64 Kio de fin des erreurs (journal), 8 Mio de sortie standard (JSON de ffprobe) ;
 *   - **environnement réduit** : ffmpeg ne reçoit ni les secrets du serveur (base, stockage, signature)
 *     ni les mandataires HTTP ; il n'a besoin que du chemin des programmes et des bibliothèques.
 *
 * Progression : avec `onProgress`, la sortie standard est le flux `-progress pipe:1` de ffmpeg (blocs
 * `clé=valeur` terminés par `progress=continue|end`), lu ligne à ligne.
 *
 * Serveur arrêté brutalement (SIGKILL, plantage) : rien ne tue ffmpeg (il ignore la fermeture de ses
 * tubes, vérifié), qui finit son travail en priorité la plus basse ; la tâche est reprise par un autre
 * processus à l'expiration du bail. Sous Linux, la limite de temps processeur (`prlimit --cpu`, appliquée
 * par le noyau) borne quand même une boucle de décodage sans fin d'un tel orphelin. Arrêt normal du
 * serveur (SIGTERM, rechargement en développement) : le processus de travail arrête ses tâches (signal).
 */

export interface RunOptions {
  args: readonly string[]
  /** Délai total (ms) avant l'arrêt de l'arbre de processus. */
  timeoutMs: number
  /** Arrêt demandé (bail perdu, tâche annulée, arrêt du serveur). */
  signal?: AbortSignal
  /** Secondes de sortie écrites, lues dans `-progress pipe:1` (la sortie standard n'est alors pas gardée). */
  onProgress?: (seconds: number) => void
  /** Mémoire virtuelle maximale (octets), appliquée sous Linux par `prlimit --as` ; null = sans limite. */
  memoryLimit?: number | null
  /**
   * Durée de sortie maximale (s), lue dans la progression (avec `onProgress` seulement) : au-delà (plus
   * OUTPUT_DURATION_TOLERANCE), l'arbre de processus est arrêté (`tooLong`). NUXT_VIDEO_MAX_DURATION pour
   * un encodage : la durée annoncée par le fichier peut manquer (WebM, MKV en direct) ou mentir.
   */
  maxOutputSeconds?: number
  /** Sortie standard gardée au plus (octets) ; au-delà, le processus est arrêté (`overflow`). */
  stdoutLimit?: number
  /**
   * POSIX : nouveau groupe de processus (défaut), tué d'un coup avec ses descendants, et à l'abri d'un
   * Ctrl+C adressé au serveur (arrêt propre : la tâche est rendue avant que ffmpeg soit tué). false en
   * développement : `nuxt dev` s'arrête sur Ctrl+C sans crochet `close` ; ffmpeg, resté dans le groupe
   * du terminal, reçoit le même signal au lieu de continuer seul.
   */
  detached?: boolean
}

export interface RunResult {
  /** Code de sortie, null si le processus a été tué. */
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  /** Fin de la sortie d'erreur (64 Kio au plus) : journal, jamais montrée telle quelle (chemins du serveur). */
  stderrTail: string
  timedOut: boolean
  aborted: boolean
  /** Sortie standard au-delà de `stdoutLimit` : processus arrêté. */
  overflow: boolean
  /** Durée de sortie au-delà de `maxOutputSeconds` : processus arrêté. */
  tooLong: boolean
  /** Chemins de fichiers de la commande (arguments `file:`) : retirés du résumé des erreurs (`toolFailure`). */
  paths: string[]
}

/** Erreur d'une opération ffmpeg, avec le code d'échec de la tâche et un résumé sans chemin du serveur. */
export class VideoToolError extends Error {
  constructor(readonly code: VideoJobErrorCode, detail: string) {
    super(detail)
    this.name = 'VideoToolError'
  }
}

export const STDERR_TAIL_BYTES = 64 * 1024
export const STDOUT_LIMIT_BYTES = 8 * 1024 * 1024
/** Ligne de progression plus longue : ignorée (ffmpeg n'en écrit jamais d'aussi longues). */
const PROGRESS_LINE_MAX = 4096

/** Écart toléré entre la durée de sortie et `maxOutputSeconds` (son un peu plus long que l'image, durée estimée). */
export const OUTPUT_DURATION_TOLERANCE = 10

/** Délais des opérations (§ 36) : analyse, affiche (une image), copie sans réencodage. */
export const PROBE_TIMEOUT_MS = 60_000
export const POSTER_TIMEOUT_MS = 120_000
export const REMUX_TIMEOUT_MS = 600_000
/** Plafond d'un encodage, quelle que soit la durée (3 h de vidéo au plus par défaut, NUXT_VIDEO_MAX_DURATION). */
export const ENCODE_TIMEOUT_MAX_MS = 24 * 3600 * 1000

/**
 * Délai d'un encodage : 10 × la durée + 120 s (§ 36), plafonné. Large à dessein (une seule tâche par
 * cœur, priorité la plus basse sur une machine chargée) : il arrête une boucle de décodage, pas un
 * encodage lent. Durée inconnue : celle de la plus longue vidéo acceptée (`maxDuration`,
 * NUXT_VIDEO_MAX_DURATION), dont la sortie est de toute façon bornée (`maxOutputSeconds`) ; un fichier
 * sans durée ne coûte jamais plus qu'une vidéo de la durée maximale.
 */
export function encodeTimeoutMs(duration: number | null, maxDuration: number): number {
  const known = duration !== null && Number.isFinite(duration) && duration > 0 ? duration : maxDuration
  return Math.min(ENCODE_TIMEOUT_MAX_MS, Math.ceil(known * 10_000) + 120_000)
}

// ─── Progression (`-progress pipe:1`) ────────────────────────────────────────

/** Ligne `clé=valeur` du flux de progression, ou null. */
export function parseProgressLine(line: string): { key: string, value: string } | null {
  const index = line.indexOf('=')
  if (index <= 0) return null
  return { key: line.slice(0, index).trim(), value: line.slice(index + 1).trim() }
}

/** Secondes d'un champ `out_time` (`HH:MM:SS.micro`), null si absent ou `N/A`. */
function clockSeconds(value: string): number | null {
  const match = /^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value)
  if (!match) return null
  const seconds = Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4])
  return match[1] ? -seconds : seconds
}

/** Secondes d'après les champs d'un bloc : `out_time_us`, puis `out_time_ms` (en µs malgré son nom), puis `out_time`. */
function progressSeconds(fields: ReadonlyMap<string, string>): number | null {
  let seconds: number | null = null
  for (const key of ['out_time_us', 'out_time_ms']) {
    const value = fields.get(key)
    if (value !== undefined && /^-?\d+$/.test(value)) {
      seconds = Number(value) / 1_000_000
      break
    }
  }
  if (seconds === null) {
    const clock = fields.get('out_time')
    seconds = clock === undefined ? null : clockSeconds(clock)
  }
  // Valeurs négatives ou N/A au tout début d'un encodage : pas encore de progression.
  return seconds === null || !Number.isFinite(seconds) || seconds < 0 ? null : seconds
}

/** Secondes de sortie écrites d'après un bloc de progression (plusieurs lignes `clé=valeur`), ou null. */
export function parseProgressBlock(block: string): number | null {
  const fields = new Map<string, string>()
  for (const line of block.split(/\r?\n/)) {
    const field = parseProgressLine(line)
    if (field) fields.set(field.key, field.value)
  }
  return progressSeconds(fields)
}

/** Lecteur du flux de progression : appelle `emit` à la fin de chaque bloc (`progress=…`). */
function progressReader(emit: (seconds: number) => void): (chunk: string) => void {
  let partial = ''
  let fields = new Map<string, string>()
  return (chunk) => {
    const lines = (partial + chunk).split(/\r?\n/)
    partial = lines.pop() ?? ''
    if (partial.length > PROGRESS_LINE_MAX) partial = ''
    for (const line of lines) {
      const field = parseProgressLine(line)
      if (!field) continue
      if (field.key !== 'progress') {
        fields.set(field.key, field.value)
        continue
      }
      const seconds = progressSeconds(fields)
      fields = new Map()
      if (seconds !== null) emit(seconds)
    }
  }
}

// ─── Environnement, mémoire, arrêt ───────────────────────────────────────────

/** Variables transmises à ffmpeg (noms comparés sans casse : Windows écrit `Path`). */
const ENVIRONMENT_KEYS = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL',
  'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH',
])

/**
 * Environnement réduit de ffmpeg : chemins des programmes et bibliothèques seulement. Les secrets du
 * serveur (NUXT_*, DATABASE_URL, clés S3) et les mandataires (http_proxy) ne sont jamais transmis.
 *   - `SVT_LOG=1` : l'encodeur AV1 n'écrit que ses erreurs (sinon sa bannière remplit la fin du journal) ;
 *   - `MALLOC_ARENA_MAX=2` (glibc, ignoré ailleurs) : sans lui, chaque fil de ffmpeg peut réserver sa
 *     propre zone d'allocation (64 Mio d'espace d'adressage, jusqu'à 8 × le nombre de cœurs), réserve
 *     inutilisée mais comptée par `prlimit --as` : la même vidéo échouerait selon la machine. Mesuré sur
 *     un rendu 4K HDR à 16 fils : 4,1 Gio d'espace d'adressage au plus haut sans, 2,6 Gio avec, même durée.
 */
export function toolEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && ENVIRONMENT_KEYS.has(key.toUpperCase())) result[key] = value
  }
  result.SVT_LOG = '1'
  result.MALLOC_ARENA_MAX = '2'
  return result
}

let prlimitPath: Promise<string | null> | undefined

/** `prlimit` (util-linux) dans le PATH, sous Linux seulement ; cherché une fois. */
function findPrlimit(): Promise<string | null> {
  if (process.platform !== 'linux') return Promise.resolve(null)
  prlimitPath ??= (async () => {
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      if (!directory) continue
      const candidate = join(directory, 'prlimit')
      try {
        await access(candidate, constants.X_OK)
        return candidate
      }
      catch {}
    }
    return null
  })()
  return prlimitPath
}

/**
 * Temps processeur maximal (s) : tous les cœurs pendant tout le délai, donc jamais atteint par un
 * lancement que le délai n'a pas déjà arrêté. Il ne sert qu'à borner un ffmpeg devenu orphelin.
 */
export function cpuLimitSeconds(timeoutMs: number): number {
  return Math.max(1, Math.ceil(timeoutMs / 1000)) * availableParallelism()
}

/**
 * Commande lancée : l'outil, ou sous Linux `prlimit [--as=<octets>] --cpu=<s> -- outil` (prlimit
 * applique les limites puis remplace son propre processus par l'outil : même pid, même priorité).
 */
async function command(binary: string, args: readonly string[], options: RunOptions): Promise<{ file: string, args: string[], wrapped: boolean }> {
  const prlimit = await findPrlimit()
  if (!prlimit) return { file: binary, args: [...args], wrapped: false }
  const limits = options.memoryLimit ? [`--as=${Math.floor(options.memoryLimit)}`] : []
  limits.push(`--cpu=${cpuLimitSeconds(options.timeoutMs)}`)
  return { file: prlimit, args: [...limits, '--', binary, ...args], wrapped: true }
}

/**
 * Échec de lancement dû au réglage (programme absent ou non exécutable) : le traitement ne peut pas
 * fonctionner sur ce processus. Les autres (EAGAIN, EMFILE, ENOMEM : machine momentanément saturée) sont
 * passagers : nouvel essai, la boucle continue.
 */
export function isMissingTool(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR' || code === 'EPERM'
}

/** Outil introuvable derrière `prlimit` (qui sort alors en 127 avec ce message) : même erreur qu'un lancement direct. */
function wrappedSpawnError(binary: string, code: number | null, stderr: string): NodeJS.ErrnoException | null {
  if (code !== 127 || !/^prlimit: failed to execute /m.test(stderr)) return null
  return Object.assign(new Error(`spawn ${binary} ENOENT`), { code: 'ENOENT', syscall: 'spawn', path: binary })
}

/**
 * Arrête le processus et ses descendants : groupe POSIX créé par `detached` (tué même si son chef est
 * déjà sorti, tant que des descendants gardent les tubes ouverts), arbre Windows (`taskkill /T`).
 */
function killTree(child: ChildProcess, group: boolean): void {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.on('error', () => child.kill('SIGKILL'))
    return
  }
  try {
    // Hors groupe (développement) : ffmpeg ne crée pas de processus (prlimit le remplace, même pid).
    process.kill(group ? -pid : pid, 'SIGKILL')
  }
  catch {
    // Groupe déjà vide (ESRCH) : rien à arrêter.
  }
}

/**
 * Lance un outil et attend sa fin (fermeture de ses sorties). Résout quel que soit le code de sortie ;
 * rejette seulement si le programme ne peut pas être lancé (ENOENT, EACCES…). Un signal déjà déclenché
 * résout aussitôt (`aborted`) sans rien lancer.
 */
export async function runTool(binary: string, options: RunOptions): Promise<RunResult> {
  const { signal, onProgress, maxOutputSeconds } = options
  const stdoutLimit = options.stdoutLimit ?? STDOUT_LIMIT_BYTES
  const paths = commandPaths(options.args)
  const notStarted: RunResult = { code: null, signal: null, stdout: '', stderrTail: '', timedOut: false, aborted: true, overflow: false, tooLong: false, paths }
  if (signal?.aborted) return notStarted
  const { file, args, wrapped } = await command(binary, options.args, options)
  // Arrêt demandé pendant la recherche de `prlimit`.
  if (signal?.aborted) return notStarted

  // Nouveau groupe de processus (POSIX) : tué d'un coup, descendants compris (voir `RunOptions.detached`).
  const group = process.platform !== 'win32' && options.detached !== false
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: group,
      windowsHide: true,
      shell: false,
      env: toolEnvironment(process.env),
    })
    // Aussitôt lancé : ffmpeg n'a pas encore créé ses fils, qui hériteront de la priorité.
    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, 19)
      }
      catch {}
    }

    let timedOut = false
    let aborted = false
    let overflow = false
    let tooLong = false
    const stdout: Buffer[] = []
    let stdoutSize = 0
    let stderr = Buffer.alloc(0)

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child, group)
    }, options.timeoutMs)
    const onAbort = () => {
      aborted = true
      killTree(child, group)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    if (onProgress) {
      const decoder = new StringDecoder('utf8')
      const read = progressReader((seconds) => {
        if (tooLong) return
        if (maxOutputSeconds !== undefined && seconds > maxOutputSeconds + OUTPUT_DURATION_TOLERANCE) {
          tooLong = true
          killTree(child, group)
          return
        }
        // Une erreur de l'appelant (écriture de l'avancement) ne doit ni arrêter ffmpeg ni le serveur.
        try {
          onProgress(seconds)
        }
        catch {}
      })
      child.stdout!.on('data', (chunk: Buffer) => read(decoder.write(chunk)))
    }
    else {
      child.stdout!.on('data', (chunk: Buffer) => {
        if (overflow) return
        stdoutSize += chunk.length
        if (stdoutSize > stdoutLimit) {
          overflow = true
          stdout.length = 0
          killTree(child, group)
          return
        }
        stdout.push(chunk)
      })
    }
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk])
      if (stderr.length > STDERR_TAIL_BYTES) stderr = stderr.subarray(stderr.length - STDERR_TAIL_BYTES)
    })

    child.on('error', (error) => {
      // Programme introuvable ou non exécutable : aucun processus n'a été créé. Les autres erreurs
      // (envoi d'un signal) n'empêchent pas la fin normale, attendue sur `close`.
      if (child.pid !== undefined) return
      cleanup()
      reject(error)
    })
    child.on('close', (code, exitSignal) => {
      cleanup()
      const stderrTail = stderr.toString('utf8')
      const missing = wrapped ? wrappedSpawnError(binary, code, stderrTail) : null
      if (missing) {
        reject(missing)
        return
      }
      resolve({
        code,
        signal: exitSignal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderrTail,
        timedOut,
        aborted,
        overflow,
        tooLong,
        paths,
      })
    })
  })
}

// ─── Erreurs ─────────────────────────────────────────────────────────────────

/** Chemins absolus (POSIX, Windows, `file:`) : jamais montrés à l'utilisateur. */
const PATH_PATTERN = /(?:file:)?(?:[A-Za-z]:)?[\\/](?:[^\s'"\\/:]+[\\/])+[^\s'":]*/g

/** Chemins de fichiers d'une commande (arguments `file:…`, args.ts `fileUrl`). */
function commandPaths(args: readonly string[]): string[] {
  return args.filter(arg => arg.startsWith('file:') && arg.length > 'file:'.length).map(arg => arg.slice('file:'.length))
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Motif des chemins connus, espaces compris : chaque chemin, puis son dossier (celui de la tâche) suivi
 * d'un nom de fichier, avec ou sans `file:`. Jamais un dossier racine seul (`/tmp`, `C:`), qui masquerait
 * des mots ordinaires. Chemins complets d'abord, les plus longs en premier : jamais masqués à moitié.
 */
function knownPathPattern(paths: readonly string[]): RegExp | null {
  const byLength = (a: string, b: string) => b.length - a.length
  const files = [...new Set(paths.filter(Boolean))].sort(byLength)
  const directories = [...new Set(files.map(path => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))))]
    .filter(directory => /.[\\/]./.test(directory))
    .sort(byLength)
  const alternatives = [
    ...files.map(escapeRegExp),
    ...directories.map(directory => `${escapeRegExp(directory)}(?:[\\\\/][^\\s'":]*)?`),
  ]
  return alternatives.length > 0 ? new RegExp(`(?:file:)?(?:${alternatives.join('|')})`, 'g') : null
}

/**
 * Résumé d'une sortie d'erreur pour `MediaJob.errorDetail` : dernières lignes utiles, chemins du serveur
 * remplacés par « … », 191 caractères au plus. Les chemins connus (`paths` : ceux de la commande) sont
 * masqués en entier, espaces compris (`C:\Users\Jean Dupont\…`, `/srv/surge media/…`) ; le motif
 * générique, qui s'arrête au premier espace, ne sert qu'aux autres.
 */
export function stderrSummary(stderrTail: string, paths: readonly string[] = []): string {
  const known = knownPathPattern(paths)
  const lines = stderrTail.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-3)
  const text = lines.join(' | ')
  return truncateText((known ? text.replace(known, '…') : text).replace(PATH_PATTERN, '…'))
}

/**
 * Erreur d'un lancement en échec : délai dépassé → `TIMEOUT`, durée de sortie au-delà de la limite →
 * `TOO_LONG`, sinon `code` (fichier illisible pour ffprobe, conversion en échec pour ffmpeg). À n'appeler
 * que si le lancement n'a pas été interrompu.
 */
export function toolFailure(result: RunResult, code: VideoJobErrorCode): VideoToolError {
  if (result.timedOut) return new VideoToolError('TIMEOUT', 'Délai de l\'opération dépassé.')
  if (result.tooLong) return new VideoToolError('TOO_LONG', 'Durée de la vidéo au-delà de la limite.')
  if (result.overflow) return new VideoToolError(code, 'Sortie de l\'outil trop volumineuse.')
  const summary = stderrSummary(result.stderrTail, result.paths)
  const status = result.code === null ? `signal ${result.signal ?? '?'}` : `code ${result.code}`
  return new VideoToolError(code, truncateText(summary ? `${status} : ${summary}` : status))
}
