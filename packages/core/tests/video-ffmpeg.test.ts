import { execFile, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { VideoContainer, VideoMetadata } from '../shared/utils/video'
import type { RenditionMode } from '../shared/utils/video-processing'
import { av1Args, h264Args, INPUT_FORMATS, posterArgs, sanitizeArgs, webmRepairArgs } from '../server/lib/video-processing/args'
import { detectFfmpeg, type FfmpegCapabilities } from '../server/lib/video-processing/ffmpeg'
import { type ProbeResult, runFfprobe } from '../server/lib/video-processing/ffprobe'
import { frameLuminance, planVideoJob, POSTER_DARK_LUMINANCE, posterTimes } from '../server/lib/video-processing/plan'
import { cpuLimitSeconds, runTool, toolEnvironment, toolFailure, VideoToolError } from '../server/lib/video-processing/run'
import { probeVideoFile } from '../server/lib/media/video/probe'

/**
 * Traitement des vidéos (phase D3) avec de vrais processus : lancement borné (priorité, délai, arbre de
 * processus, mémoire, temps processeur, environnement) puis ffmpeg réel sur des vidéos **fabriquées pendant le test** par
 * lavfi (1 à 2 s, petite définition, un fil) : HEVC 10 bits HLG tournée, MKV à 120 i/s, AVI, MPEG-TS, OGV,
 * WMV, 3GP, MP4 avec une piste GPS GoPro (`gpmd`) et un lieu de tournage, WebM des navigateurs (fixtures),
 * WebM H.264 de Chrome, MPEG-TS et DV entrelacés, 4K HDR (mémoire).
 * Chaque sortie est relue par le lecteur de D1 (probeVideoFile), comme le fera le pipeline. Fichiers
 * hostiles : liste HLS déguisée en AVI qui vise un fichier local et une URL locale (serveur témoin).
 * Sans ffmpeg (poste Windows), ces tests sont signalés « ignorés », jamais réussis en silence.
 */

const FFMPEG = process.env.NUXT_FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.NUXT_FFPROBE_PATH || 'ffprobe'
const hasFfmpeg = spawnSync(FFMPEG, ['-hide_banner', '-version'], { stdio: 'ignore' }).status === 0
  && spawnSync(FFPROBE, ['-hide_banner', '-version'], { stdio: 'ignore' }).status === 0
const posix = process.platform !== 'win32'
/** Code de sortie d'un processus arrêté par runTool : null sous POSIX (signal SIGKILL), 1 sous Windows (`taskkill /F`, vérifié le 2026-10-10). */
const KILLED_CODE = posix ? null : 1
const hasSvtAv1 = hasFfmpeg && /\slibsvtav1\s/.test(spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout ?? '')
const hasPrlimit = process.platform === 'linux' && spawnSync('prlimit', ['--version'], { stdio: 'ignore' }).status === 0

const GIB = 1024 * 1024 * 1024
const settings = { ffmpegPath: FFMPEG, ffprobePath: FFPROBE, memoryLimit: 4 * GIB }
const FIXTURES = new URL('./fixtures/video/', import.meta.url)

// ─── Lancement borné (sans ffmpeg) ───────────────────────────────────────────

describe.skipIf(!posix)('runTool : processus enfant borné', () => {
  it('priorité la plus basse, héritée par les descendants', async () => {
    // `nice` sans argument affiche la priorité du processus (enfant du shell, lancé après le réglage).
    const result = await runTool('/bin/sh', { args: ['-c', 'sleep 0.2; nice'], timeoutMs: 10_000 })
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('19')
  })

  it('délai dépassé : tout le groupe de processus est tué, résultat aussitôt', async () => {
    const started = Date.now()
    // Le `sleep` en arrière-plan garde la sortie ouverte : seul l'arrêt du groupe débloque la fin.
    const result = await runTool('/bin/sh', { args: ['-c', 'sleep 30 & sleep 30; wait'], timeoutMs: 300 })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(result).toMatchObject({ code: null, signal: 'SIGKILL', timedOut: true, aborted: false })
  })

  it('arrêt demandé (bail perdu, arrêt du serveur), signal déjà déclenché : rien n\'est lancé', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const started = Date.now()
    const result = await runTool('/bin/sh', { args: ['-c', 'sleep 30 & sleep 30; wait'], timeoutMs: 60_000, signal: controller.signal })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(result).toMatchObject({ code: null, timedOut: false, aborted: true })
    expect(await runTool('/bin/sh', { args: ['-c', 'echo lancé'], timeoutMs: 1_000, signal: controller.signal })).toMatchObject({ aborted: true, stdout: '' })
  })

  it.skipIf(!hasPrlimit)('limites du noyau (Linux, prlimit) : mémoire virtuelle, temps processeur jamais atteint avant le délai', async () => {
    const result = await runTool('/bin/sh', { args: ['-c', 'ulimit -v; ulimit -t'], timeoutMs: 3_000, memoryLimit: GIB })
    expect(result.stdout.trim().split('\n')).toEqual([String(GIB / 1024), String(cpuLimitSeconds(3_000))])
    expect(cpuLimitSeconds(3_000)).toBe(3 * availableParallelism())
  })

  it('programme introuvable : rejet ENOENT, aussi derrière prlimit', async () => {
    await expect(runTool('/nonexistent/ffmpeg', { args: ['-version'], timeoutMs: 1_000 })).rejects.toMatchObject({ code: 'ENOENT' })
    if (hasPrlimit) await expect(runTool('/nonexistent/ffmpeg', { args: ['-version'], timeoutMs: 1_000, memoryLimit: GIB })).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('sorties bornées : sortie standard au-delà de la limite (processus arrêté), 64 Kio de fin d\'erreurs', async () => {
    const big = await runTool('/bin/sh', { args: ['-c', 'head -c 1000000 /dev/zero; sleep 30'], timeoutMs: 10_000, stdoutLimit: 1_000 })
    expect(big).toMatchObject({ overflow: true, timedOut: false, stdout: '' })
    const noisy = await runTool('/bin/sh', { args: ['-c', 'head -c 200000 /dev/zero | tr "\\000" x >&2; echo fin >&2'], timeoutMs: 10_000 })
    expect(noisy.code).toBe(0)
    expect(noisy.stderrTail).toHaveLength(64 * 1024)
    expect(noisy.stderrTail.endsWith('xfin\n')).toBe(true)
  })

  it('progression : blocs `-progress` lus ligne à ligne, même coupés entre deux lectures', async () => {
    const seconds: number[] = []
    const script = 'printf "frame=1\\nout_time_us=N/A\\nprogress=continue\\nout_time_us=50"; sleep 0.1; printf "0000\\nprogress=continue\\nout_time_us=1000000\\nprogress=end\\n"'
    const result = await runTool('/bin/sh', { args: ['-c', script], timeoutMs: 10_000, onProgress: value => seconds.push(value) })
    expect(result).toMatchObject({ code: 0, stdout: '' })
    expect(seconds).toEqual([0.5, 1])
  })

  it('environnement réduit : ni secrets du serveur ni mandataires', async () => {
    const saved = { ...process.env }
    try {
      Object.assign(process.env, { NUXT_MEDIA_SIGNING_SECRET: 'secret-de-test', DATABASE_URL: 'file:./x.db', http_proxy: 'http://127.0.0.1:9' })
      const result = await runTool('/bin/sh', { args: ['-c', 'env'], timeoutMs: 10_000 })
      expect(result.stdout).not.toMatch(/secret-de-test|DATABASE_URL|http_proxy/)
      expect(result.stdout).toMatch(/^PATH=/m)
    }
    finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
      Object.assign(process.env, saved)
    }
  })
})

// ─── ffmpeg réel ─────────────────────────────────────────────────────────────

/**
 * « Peignes » d'une image (JPEG) : écart moyen de luminance entre lignes voisines rapporté à celui entre
 * lignes distantes de deux. Image nette ≈ 0,5 ; image entrelacée en mouvement > 1,5 (les lignes voisines
 * viennent de deux instants).
 */
async function combing(path: string): Promise<number> {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true })
  let adjacent = 0
  let apart = 0
  for (let y = 0; y + 2 < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const pixel = data[y * info.width + x]!
      adjacent += Math.abs(pixel - data[(y + 1) * info.width + x]!)
      apart += Math.abs(pixel - data[(y + 2) * info.width + x]!)
    }
  }
  return adjacent / apart
}

const execFileResult = (file: string, args: string[]) => new Promise<{ code: number | null, stdout: string, stderr: string }>((resolve) => {
  execFile(file, args, { env: toolEnvironment(process.env), maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr })
  })
})

/** Fabrique une vidéo avec lavfi (hors des constructeurs d'arguments : lavfi n'y est jamais permis). */
async function generate(output: string, args: string[]): Promise<void> {
  const result = await execFileResult(FFMPEG, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-filter_threads', '1', ...args, '-threads', '1', '-y', output])
  if (result.code !== 0) throw new Error(`génération de ${output} : ${result.stderr}`)
}

const video = (size: string, rate: number, duration: number, source = 'testsrc2') =>
  ['-f', 'lavfi', '-i', `${source}${source.includes('=') ? ':' : '='}size=${size}:rate=${rate}:duration=${duration}`]
const tone = (duration: number) => ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${duration}`]
const X264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']
/**
 * HEVC HLG : couleurs écrites aussi dans le flux (VUI de x265). Les versions récentes de ffmpeg (développement,
 * octobre 2026) n'y reportent plus `-color_trc`/`-color_primaries` seuls : le fichier serait alors SDR pour ffprobe.
 */
const HLG_X265 = 'log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc'

/** Lance ffmpeg avec des arguments construits par args.ts ; échec → erreur avec la fin du journal. */
async function ffmpeg(args: string[], onProgress?: (seconds: number) => void) {
  const result = await runTool(FFMPEG, { args, timeoutMs: 60_000, memoryLimit: settings.memoryLimit, onProgress })
  if (result.code !== 0) throw new Error(`ffmpeg ${result.code} : ${result.stderrTail}`)
  return result
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

/**
 * Enregistrement `video/webm;codecs=h264` de Chrome : Matroska sans durée ni index (`-live 1`) dont
 * l'en-tête dit « webm » (DocType complété de zéros, permis par EBML), comme sniff.ts le détecte.
 */
function asChromeWebm(file: Buffer): Buffer {
  const patched = Buffer.from(file)
  const at = patched.indexOf('matroska')
  if (at === -1 || at > 64) throw new Error('DocType introuvable')
  patched.write('webm\0\0\0\0', at, 'latin1')
  return patched
}

/** Remplace la piste de codes temporels (`tmcd`) d'un MP4 écrit par ffmpeg par une piste GPS GoPro (`hdlr` meta, entrée `gpmd`). */
function asGoProTrack(file: Buffer): Buffer {
  const patched = Buffer.from(file)
  let replaced = 0
  for (let at = patched.indexOf('hdlr'); at !== -1; at = patched.indexOf('hdlr', at + 1)) {
    if (patched.toString('latin1', at + 12, at + 16) === 'tmcd') replaced += patched.write('meta', at + 12, 'latin1') && 1
  }
  for (let at = patched.indexOf('stsd'); at !== -1; at = patched.indexOf('stsd', at + 1)) {
    if (patched.toString('latin1', at + 16, at + 20) === 'tmcd') replaced += patched.write('gpmd', at + 16, 'latin1') && 1
  }
  if (replaced !== 2) throw new Error('piste tmcd introuvable')
  return patched
}

describe.skipIf(!hasFfmpeg)('ffmpeg réel (vidéos fabriquées par lavfi)', { timeout: 60_000 }, () => {
  let dir: string
  let capabilities: FfmpegCapabilities
  const file = (name: string) => join(dir, name)
  /** Fichiers d'entrée : conteneur détecté (sniff.ts) et chemin. */
  const inputs: Record<string, { container: VideoContainer, path: string }> = {}

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'surge-media-ffmpeg-'))
    capabilities = await detectFfmpeg(settings)
    const add = (name: string, container: VideoContainer) => {
      inputs[name] = { container, path: file(`${name}.${container}`) }
      return inputs[name]!.path
    }
    await Promise.all([
      // Téléphone : HEVC 10 bits HLG + AAC, puis tourné d'un quart de tour (matrice d'affichage) et localisé.
      generate(file('hlg-source.mov'), [...video('320x180', 30, 1), ...tone(1), '-c:v', 'libx265', '-x265-params', HLG_X265, '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
        '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-c:a', 'aac', '-shortest'])
        .then(() => generate(add('iphone', 'mov'), ['-display_rotation:v:0', '-90', '-i', file('hlg-source.mov'), '-c', 'copy', '-metadata', 'location=+48.8584+002.2945/'])),
      generate(add('fast', 'mkv'), [...video('320x180', 120, 1), ...tone(1), ...X264, '-c:a', 'aac', '-shortest']),
      generate(add('camcorder', 'avi'), [...video('320x240', 25, 1), ...tone(1), '-c:v', 'mpeg4', '-c:a', 'libmp3lame', '-shortest']),
      generate(add('broadcast', 'ts'), [...video('320x240', 25, 1), ...tone(1), '-c:v', 'mpeg2video', '-c:a', 'mp2', '-shortest']),
      generate(add('theora', 'ogv'), [...video('320x240', 25, 1), ...tone(1), '-c:v', 'libtheora', '-c:a', 'libvorbis', '-shortest']),
      generate(add('windows', 'wmv'), [...video('320x240', 25, 1), ...tone(1), '-c:v', 'wmv2', '-c:a', 'wmav2', '-shortest']),
      generate(add('phone', '3gp'), [...video('176x144', 15, 1), ...tone(1), ...X264, '-c:a', 'aac', '-ac', '1', '-ar', '8000', '-shortest']),
      generate(add('portrait', 'mp4'), [...video('1200x1600', 10, 0.5), ...X264]),
      generate(add('black', 'mp4'), [...video('320x180', 10, 1, 'color=c=black'), ...X264]),
      // GoPro : piste de codes temporels écrite par ffmpeg, puis transformée en piste GPS.
      generate(file('timecode.mp4'), [...video('320x180', 30, 1), ...tone(1), ...X264, '-c:a', 'aac', '-shortest',
        '-timecode', '00:00:00:00', '-write_tmcd', '1', '-metadata', 'location=+48.8584+002.2945/'])
        .then(async () => writeFile(add('gopro', 'mp4'), asGoProTrack(await readFile(file('timecode.mp4'))))),
      copyFile(new URL('recorder-vp8.webm', FIXTURES), add('recorder-vp8', 'webm')),
      copyFile(new URL('recorder-vp9-opus.webm', FIXTURES), add('recorder-vp9-opus', 'webm')),
      generate(file('chrome.mkv'), [...video('320x180', 30, 1), ...tone(1), ...X264, '-c:a', 'libopus', '-shortest', '-live', '1', '-f', 'matroska'])
        .then(async () => writeFile(add('chrome-h264', 'webm'), asChromeWebm(await readFile(file('chrome.mkv'))))),
      // Entrelacés : image qui défile vite, deux trames par image prises à deux instants (« peignes »).
      // TNT ou AVCHD (H.264 1080i en MPEG-TS, ordre des trames annoncé) et DV (ordre inconnu de ffprobe).
      generate(add('interlaced', 'ts'), [...video('320x240', 50, 1), '-vf', 'scroll=horizontal=0.03,interlace=scan=tff', ...X264,
        '-flags', '+ilme+ildct', '-x264-params', 'tff=1', '-f', 'mpegts']),
      generate(add('dv', 'avi'), [...video('720x576', 50, 1), '-vf', 'scroll=horizontal=0.03,interlace=scan=bff', '-c:v', 'dvvideo', '-pix_fmt', 'yuv420p']),
    ])
  })

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const probe = (name: string) => runFfprobe(settings, inputs[name]!.container, inputs[name]!.path)

  it('détection : ffmpeg ≥ 6, libx264 et aac, ffprobe ; binaire introuvable : traitement impossible, sans erreur', async () => {
    expect(capabilities).toMatchObject({ ok: true, problems: [] })
    expect(capabilities.major).toBeGreaterThanOrEqual(6)
    expect(capabilities.encoders).toEqual(expect.arrayContaining(['libx264', 'aac']))
    const missing = await detectFfmpeg({ ffmpegPath: join(tmpdir(), 'no-ffmpeg-here'), ffprobePath: join(tmpdir(), 'no-ffprobe-here') })
    expect(missing).toEqual({ ok: false, version: null, major: null, encoders: [], hdrFilters: false, av1: false, problems: ['ffmpeg_unavailable', 'ffprobe_unavailable'] })
  })

  it('ffprobe, format imposé : codecs ramenés aux codes de D1, rotation, HDR, pistes de données', async () => {
    const iphone = await probe('iphone')
    expect(iphone).toMatchObject({ formatName: 'mov,mp4,m4a,3gp,3g2,mj2', audio: { codec: 'mp4a', channels: 1, sampleRate: 48_000 }, audioIndexes: [1], dataStreams: [] })
    expect(iphone.video).toMatchObject({ codec: 'hvc1', width: 180, height: 320, rotation: 90, fps: 30, bitDepth: 10, hdr: 'hlg' })
    expect(iphone.duration).toBeCloseTo(1, 1)

    const expected: Record<string, [string, string]> = {
      fast: ['avc1', 'mp4a'],
      camcorder: ['mp4v', 'mp3'],
      broadcast: ['mpeg2video', 'mp2'],
      theora: ['theora', 'vorbis'],
      windows: ['wmv2', 'wmav2'],
      phone: ['avc1', 'mp4a'],
      'recorder-vp8': ['vp8', ''],
      'recorder-vp9-opus': ['vp9', 'opus'],
    }
    const results = await Promise.all(Object.keys(expected).map(name => probe(name)))
    Object.keys(expected).forEach((name, i) => {
      const [videoCodec, audioCodec] = expected[name]!
      expect({ name, video: results[i]!.video?.codec, audio: results[i]!.audio?.codec ?? '' }).toEqual({ name, video: videoCodec, audio: audioCodec })
    })
    expect((await probe('fast')).video?.fps).toBe(120)
    // WebM des navigateurs : ni durée ni cadence.
    expect(results[6]).toMatchObject({ duration: null, video: { fps: null } })

    const gopro = await probe('gopro')
    expect(gopro.dataStreams).toEqual(['gpmd'])
    expect(gopro.video?.codec).toBe('avc1')
  })

  it('format imposé : un fichier d\'un autre format n\'est jamais deviné (UNREADABLE) ; résumé sans le chemin, espaces compris', async () => {
    await expect(runFfprobe(settings, 'avi', inputs.fast!.path)).rejects.toMatchObject({ code: 'UNREADABLE' })
    await expect(runFfprobe(settings, 'mp4', inputs.camcorder!.path)).rejects.toBeInstanceOf(VideoToolError)
    await expect(runFfprobe({ ...settings, ffprobePath: '/nonexistent/ffprobe' }, 'mkv', inputs.fast!.path)).rejects.toMatchObject({ code: 'FFMPEG_UNAVAILABLE' })
    // Dossier de stockage ou de l'utilisateur avec des espaces : rien du chemin dans le message montré.
    await mkdir(file('Jean Dupont'))
    const spaced = file('Jean Dupont/ma vidéo.avi')
    await copyFile(inputs.camcorder!.path, spaced)
    const error = await runFfprobe(settings, 'mp4', spaced).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(VideoToolError)
    expect((error as VideoToolError).message).toMatch(/Invalid data/)
    expect((error as VideoToolError).message).not.toMatch(/Jean|Dupont|vidéo|surge-media-ffmpeg|tmp/)
  })

  /** Plan d'après l'analyse, comme le pipeline (métadonnées et durée de D1 quand le test les donne). */
  const planFor = (name: string, probe: ProbeResult, options: { rendition?: RenditionMode, metadata?: VideoMetadata, duration?: number | null } = {}) => planVideoJob({
    container: inputs[name]!.container,
    metadata: options.metadata ?? null,
    duration: options.duration ?? null,
    probe,
    hasPoster: false,
    settings: { rendition: options.rendition ?? 'auto', av1: true, maxDuration: 10_800 },
    capabilities,
    existing: [],
  })

  /** Paquets vidéo et cadence d'une sortie (ffprobe, lecture des paquets sans décodage). */
  async function videoPackets(path: string): Promise<{ packets: number, rate: string }> {
    const result = await execFileResult(FFPROBE, ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets,r_frame_rate', '-of', 'json', path])
    const stream = (JSON.parse(result.stdout) as { streams: { nb_read_packets: string, r_frame_rate: string }[] }).streams[0]!
    return { packets: Number(stream.nb_read_packets), rate: stream.r_frame_rate }
  }

  it('rendu H.264 d\'une vidéo de téléphone HEVC 10 bits HLG tournée : SDR 8 bits, rotation appliquée, sans lieu', async () => {
    const source = await probe('iphone')
    const plan = planFor('iphone', source)
    expect(plan).toMatchObject({ failure: null, toneMap: capabilities.hdrFilters, target: { width: 180, height: 320 } })
    expect(plan.steps).toEqual(capabilities.av1 ? ['transcode', 'av1', 'poster'] : ['transcode', 'poster'])
    expect((await probeVideoFile(inputs.iphone!.path, 'video/quicktime')).metadata).toMatchObject({ rotation: 90, videoCodec: 'hvc1', hasLocation: true })

    const output = file('iphone-h264.mp4')
    const progress: number[] = []
    await ffmpeg(h264Args({
      input: inputs.iphone!.path, container: 'mov', output, threads: 1, preset: 'veryfast', crf: 23,
      streams: { video: source.video!.index, audio: source.audio!.index },
      target: plan.target!, fps: source.video!.fps, toneMap: plan.toneMap ? source.video!.hdr : null,
    }), seconds => progress.push(seconds))
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)).toBeGreaterThan(0.5)

    const result = await probeVideoFile(output, 'video/mp4')
    expect(result).toMatchObject({ width: 180, height: 320 })
    expect(result.duration).toBeCloseTo(1, 1)
    expect(result.metadata).toMatchObject({ videoCodec: 'avc1', audioCodec: 'mp4a', hasAudio: true, rotation: 0, faststart: true, hasLocation: false, playback: 'broad' })
    expect(result.metadata.codecs).toMatch(/^avc1\.64[0-9A-F]{4},mp4a\.40\.2$/)
    const rendered = await runFfprobe(settings, 'mp4', output)
    expect(rendered.video).toMatchObject({ pixFmt: 'yuv420p', bitDepth: 8, rotation: 0, hdr: null })
    expect(rendered.audio).toMatchObject({ channels: 2, sampleRate: 48_000 })
  })

  it('formats convertis (MKV, AVI, MPEG-TS, OGV, WMV, 3GP) → rendu H.264 lu par le lecteur de D1', async () => {
    const names = ['fast', 'camcorder', 'broadcast', 'theora', 'windows', 'phone']
    await Promise.all(names.map(async (name) => {
      const source = await probe(name)
      const plan = planFor(name, source)
      expect(plan.steps).toContain('transcode')
      const output = file(`${name}-h264.mp4`)
      await ffmpeg(h264Args({
        input: inputs[name]!.path, container: inputs[name]!.container, output, threads: 1, preset: 'veryfast', crf: 23,
        streams: { video: source.video!.index, audio: source.audio?.index ?? null }, target: plan.target!, fps: source.video!.fps, toneMap: null,
      }))
      const result = await probeVideoFile(output, 'video/mp4')
      expect({ name, width: result.width, height: result.height, codec: result.metadata.videoCodec, audio: result.metadata.audioCodec, playback: result.metadata.playback })
        .toEqual({ name, ...plan.target!, codec: 'avc1', audio: 'mp4a', playback: 'broad' })
      expect(Math.abs(result.duration! - source.duration!)).toBeLessThan(0.15)
    }))
    // Cadence plafonnée à 60 i/s.
    expect((await runFfprobe(settings, 'mp4', file('fast-h264.mp4'))).video?.fps).toBe(60)
  })

  it('définition réduite (petit côté ≤ 1080, portrait) et vidéo sans son', async () => {
    const source = await probe('portrait')
    const plan = planFor('portrait', source)
    expect(plan.target).toEqual({ width: 1080, height: 1440 })
    const output = file('portrait-h264.mp4')
    await ffmpeg(h264Args({
      input: inputs.portrait!.path, container: 'mp4', output, threads: 1, preset: 'ultrafast', crf: 30,
      streams: { video: source.video!.index, audio: null }, target: plan.target!, fps: source.video!.fps, toneMap: null,
    }))
    const result = await probeVideoFile(output, 'video/mp4')
    expect(result).toMatchObject({ width: 1080, height: 1440, metadata: { hasAudio: false, audioCodec: null } })
  })

  it('enregistrement d\'un navigateur (cadence inconnue, 1000 i/s annoncés) → rendu H.264 à 60 i/s au plus, niveau H.264 courant', async () => {
    const source = await probe('recorder-vp9-opus')
    expect(source.video?.fps).toBeNull()
    const plan = planFor('recorder-vp9-opus', source, { rendition: 'always' })
    const output = file('recorder-h264.mp4')
    await ffmpeg(h264Args({
      input: inputs['recorder-vp9-opus']!.path, container: 'webm', output, threads: 1, preset: 'veryfast', crf: 23,
      streams: { video: source.video!.index, audio: source.audio!.index }, target: plan.target!, fps: source.video!.fps, toneMap: null,
    }))
    // Sans borne : 2023 images à 1000 i/s pour 50 images d'origine (2 s), niveau 6.1 en 1080p.
    const { packets, rate } = await videoPackets(output)
    expect(rate).toBe('60/1')
    expect(packets).toBeLessThanOrEqual(125)
    const result = await probeVideoFile(output, 'video/mp4')
    expect(result.duration).toBeCloseTo(2, 0)
    expect(Number.parseInt(result.metadata.codecs!.slice(9, 11), 16)).toBeLessThanOrEqual(42)
    expect((await runFfprobe(settings, 'mp4', output)).video?.fps).toBe(60)
  })

  it.skipIf(!hasSvtAv1)('rendu AV1/Opus en WebM ; enregistrement d\'un navigateur, brut ou réparé (SVT-AV1 refuse plus de 240 i/s)', async () => {
    const source = await probe('fast')
    const output = file('fast-av1.webm')
    await ffmpeg(av1Args({
      input: inputs.fast!.path, container: 'mkv', output, threads: 1,
      streams: { video: source.video!.index, audio: source.audio!.index }, target: { width: 320, height: 180 }, fps: source.video!.fps, toneMap: null,
    }))
    const result = await probeVideoFile(output, 'video/webm')
    expect(result).toMatchObject({ width: 320, height: 180, metadata: { videoCodec: 'av01', audioCodec: 'opus', durationEstimated: false } })
    expect(result.duration).toBeCloseTo(1, 1)

    const recorder = inputs['recorder-vp9-opus']!.path
    const recording = await probe('recorder-vp9-opus')
    const repaired = file('recorder-repaired-for-av1.webm')
    await ffmpeg(webmRepairArgs({ input: recorder, output: repaired, video: recording.video!.index, audio: recording.audioIndexes }))
    for (const [name, input] of [['brut', recorder], ['réparé', repaired]] as const) {
      const analysis = await runFfprobe(settings, 'webm', input)
      expect({ name, fps: analysis.video?.fps }).toEqual({ name, fps: null })
      const av1 = file(`recorder-av1-${name === 'brut' ? 'raw' : 'repaired'}.webm`)
      await ffmpeg(av1Args({
        input, container: 'webm', output: av1, threads: 1,
        streams: { video: analysis.video!.index, audio: analysis.audio!.index }, target: { width: 160, height: 90 }, fps: null, toneMap: null,
      }))
      const encoded = await probeVideoFile(av1, 'video/webm')
      expect({ name, codecs: [encoded.metadata.videoCodec, encoded.metadata.audioCodec] }).toEqual({ name, codecs: ['av01', 'opus'] })
      expect(encoded.duration).toBeCloseTo(2, 0)
      expect((await videoPackets(av1)).packets).toBeLessThanOrEqual(125)
    }
  })

  it('WebM H.264 de Chrome sans durée : pas de réparation (copie en WebM impossible), le rendu H.264 est la version lisible', async () => {
    const name = 'chrome-h264'
    const d1 = await probeVideoFile(inputs[name]!.path, 'video/webm')
    expect(d1.metadata).toMatchObject({ container: 'webm', videoCodec: 'avc1', playback: 'variable', durationEstimated: true })
    const source = await probe(name)
    expect(source).toMatchObject({ duration: null, video: { codec: 'avc1' }, audio: { codec: 'opus' } })
    const plan = planFor(name, source, { metadata: d1.metadata, duration: d1.duration })
    expect(plan).toMatchObject({ failure: null, steps: capabilities.av1 ? ['transcode', 'av1', 'poster'] : ['transcode', 'poster'] })
    expect(plan.duration).toBeCloseTo(1, 0)
    // Témoin : la réparation aurait échoué (« Only VP8 or VP9 or AV1 video and Vorbis or Opus audio »).
    const repaired = file('chrome-repaired.webm')
    expect((await runTool(FFMPEG, { args: webmRepairArgs({ input: inputs[name]!.path, output: repaired, video: 0, audio: source.audioIndexes }), timeoutMs: 30_000 })).code).not.toBe(0)
    const output = file('chrome-h264.mp4')
    await ffmpeg(h264Args({
      input: inputs[name]!.path, container: 'webm', output, threads: 1, preset: 'veryfast', crf: 23,
      streams: { video: source.video!.index, audio: source.audio!.index }, target: plan.target!, fps: source.video!.fps, toneMap: null,
    }))
    expect((await probeVideoFile(output, 'video/mp4')).metadata).toMatchObject({ videoCodec: 'avc1', audioCodec: 'mp4a', playback: 'broad' })
  })

  it('sources entrelacées (MPEG-TS H.264, DV) : rendu et affiche désentrelacés, image par image', async () => {
    const extract = async (name: string, input: string, container: VideoContainer, time: number, width: number, height: number) => {
      const poster = file(`${name}.jpg`)
      await ffmpeg(posterArgs({ input, container, output: poster, threads: 1, video: 0, time, width, height, toneMap: null }))
      return combing(poster)
    }
    for (const name of ['interlaced', 'dv'] as const) {
      const { container, path } = inputs[name]!
      const source = await probe(name)
      // L'ordre des trames est annoncé pour le H.264 (plan : rendu utile), pas pour le DV (format converti de toute façon).
      expect({ name, interlaced: source.video?.interlaced }).toEqual({ name, interlaced: name === 'interlaced' })
      const plan = planFor(name, source)
      expect(plan.steps).toContain('transcode')
      // Témoin, hors des constructeurs d'arguments : image d'origine sans désentrelacement.
      const raw = file(`${name}-raw.jpg`)
      await generate(raw, ['-f', INPUT_FORMATS[container], '-i', path, '-frames:v', '1', '-q:v', '2', '-update', '1'])
      expect(await combing(raw)).toBeGreaterThan(1.5)

      expect(await extract(`${name}-poster`, path, container, 0, source.video!.width, source.video!.height)).toBeLessThan(0.8)
      const output = file(`${name}-h264.mp4`)
      await ffmpeg(h264Args({
        input: path, container, output, threads: 1, preset: 'veryfast', crf: 18,
        streams: { video: source.video!.index, audio: null }, target: plan.target!, fps: source.video!.fps, toneMap: null,
      }))
      const rendered = await runFfprobe(settings, 'mp4', output)
      expect(rendered.video).toMatchObject({ interlaced: false, fps: 25 })
      expect(await extract(`${name}-rendition`, output, 'mp4', 0.5, plan.target!.width, plan.target!.height)).toBeLessThan(0.8)
    }
  })

  it('4K HDR (HLG) sous la limite mémoire par défaut (4 Gio), même avec 64 fils demandés (bornés à 16)', { timeout: 120_000 }, async () => {
    const source = file('hlg-4k.mov')
    await generate(source, [...video('3840x2160', 30, 1), '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', HLG_X265, '-pix_fmt', 'yuv420p10le',
      '-tag:v', 'hvc1', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc'])
    const analysis = await runFfprobe(settings, 'mov', source)
    expect(analysis.video).toMatchObject({ width: 3840, height: 2160, hdr: 'hlg', bitDepth: 10 })
    const output = file('hlg-4k-h264.mp4')
    // Sans borne (64 fils de décodage, de filtres et d'encodage) : « Cannot allocate memory » sous 4 Gio.
    await ffmpeg(h264Args({
      input: source, container: 'mov', output, threads: 64, preset: 'veryfast', crf: 23,
      streams: { video: analysis.video!.index, audio: null }, target: { width: 1920, height: 1080 }, fps: analysis.video!.fps,
      toneMap: capabilities.hdrFilters ? 'hlg' : null,
    }))
    expect(await probeVideoFile(output, 'video/mp4')).toMatchObject({ width: 1920, height: 1080, metadata: { videoCodec: 'avc1' } })
  })

  it('affiche : JPEG en dimensions affichées, couleurs converties ; image noire repérée ; instant après la fin : aucune image', async () => {
    const meanLuminance = async (path: string) => frameLuminance((await sharp(path).stats()).channels.map(channel => channel.mean))
    const source = await probe('iphone')
    const [time] = posterTimes(source.duration)
    expect(time).toBeCloseTo(0.1, 2)
    const poster = file('iphone-poster.jpg')
    await ffmpeg(posterArgs({
      input: inputs.iphone!.path, container: 'mov', output: poster, threads: 1, video: source.video!.index, time: time!,
      width: source.video!.width, height: source.video!.height, toneMap: capabilities.hdrFilters ? 'hlg' : null,
    }))
    expect(await sharp(poster).metadata()).toMatchObject({ format: 'jpeg', width: 180, height: 320 })
    expect(await meanLuminance(poster)).toBeGreaterThanOrEqual(POSTER_DARK_LUMINANCE)

    const black = await probe('black')
    const dark = file('black-poster.jpg')
    await ffmpeg(posterArgs({ input: inputs.black!.path, container: 'mp4', output: dark, threads: 1, video: 0, time: 0.5, width: 320, height: 180, toneMap: null }))
    expect(black.video?.codec).toBe('avc1')
    expect(await meanLuminance(dark)).toBeLessThan(POSTER_DARK_LUMINANCE)

    const late = file('late-poster.jpg')
    const result = await runTool(FFMPEG, { args: posterArgs({ input: inputs.black!.path, container: 'mp4', output: late, threads: 1, video: 0, time: 5, width: 320, height: 180, toneMap: null }), timeoutMs: 30_000 })
    expect(result.timedOut).toBe(false)
    expect(await exists(late)).toBe(false)
  })

  it('retrait de la piste GPS (gpmd) : copie sans réencodage de la vidéo et du son, rien d\'autre', async () => {
    const source = await probe('gopro')
    const before = await probeVideoFile(inputs.gopro!.path, 'video/mp4')
    const output = file('gopro-clean.mp4')
    await ffmpeg(sanitizeArgs({ input: inputs.gopro!.path, container: 'mp4', output, video: source.video!.index, audio: source.audioIndexes }))
    const cleaned = await runFfprobe(settings, 'mp4', output)
    expect(cleaned.dataStreams).toEqual([])
    expect(cleaned.video?.codec).toBe('avc1')
    expect(cleaned.audio?.codec).toBe('mp4a')
    const after = await probeVideoFile(output, 'video/mp4')
    expect(after).toMatchObject({ width: before.width, height: before.height, metadata: { codecs: before.metadata.codecs } })
    expect(Math.abs(after.duration! - before.duration!)).toBeLessThan(0.05)
    expect(after.metadata.dataTracks ?? []).toEqual([])

    // MOV de téléphone : étiquette `hvc1` (lecture par Safari) et rotation gardées par la copie.
    const iphone = await probe('iphone')
    const mov = file('iphone-clean.mov')
    await ffmpeg(sanitizeArgs({ input: inputs.iphone!.path, container: 'mov', output: mov, video: iphone.video!.index, audio: iphone.audioIndexes }))
    expect((await probeVideoFile(mov, 'video/quicktime')).metadata).toMatchObject({ videoCodec: 'hvc1', rotation: 90, audioCodec: 'mp4a' })
  })

  it('réparation des WebM des navigateurs : durée et index écrits, sans réencodage', async () => {
    for (const [name, duration] of [['recorder-vp8', 1.961], ['recorder-vp9-opus', 1.987]] as const) {
      const before = await probeVideoFile(inputs[name]!.path, 'video/webm')
      expect(before.metadata.durationEstimated).toBe(true)
      const source = await probe(name)
      expect(planFor(name, source).steps).toContain('repair')
      const output = file(`${name}-fixed.webm`)
      await ffmpeg(webmRepairArgs({ input: inputs[name]!.path, output, video: source.video!.index, audio: source.audioIndexes }))
      const after = await probeVideoFile(output, 'video/webm')
      expect(after.metadata).toMatchObject({ durationEstimated: false, videoCodec: before.metadata.videoCodec, audioCodec: before.metadata.audioCodec })
      expect(after.duration).toBeCloseTo(duration, 2)
      expect((await runFfprobe(settings, 'webm', output)).duration).toBeCloseTo(duration, 2)
    }
  })

  it('délai et arrêt pendant un encodage ffmpeg : arbre tué, aucune attente', async () => {
    const endless = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-progress', 'pipe:1', '-f', 'null', '-']
    let started = Date.now()
    const timedOut = await runTool(FFMPEG, { args: endless, timeoutMs: 500, onProgress: () => {} })
    expect(timedOut).toMatchObject({ timedOut: true, code: KILLED_CODE })
    expect(Date.now() - started).toBeLessThan(5_000)

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    started = Date.now()
    const aborted = await runTool(FFMPEG, { args: endless, timeoutMs: 60_000, signal: controller.signal, onProgress: () => {} })
    expect(aborted).toMatchObject({ aborted: true, timedOut: false, code: KILLED_CODE })
    expect(Date.now() - started).toBeLessThan(5_000)

    // Durée de sortie bornée (fichier sans durée, ou qui ment) : arrêt au-delà de la limite, échec TOO_LONG.
    const seconds: number[] = []
    const tooLong = await runTool(FFMPEG, { args: endless, timeoutMs: 60_000, onProgress: value => seconds.push(value), maxOutputSeconds: 1 })
    expect(tooLong).toMatchObject({ tooLong: true, timedOut: false, aborted: false, code: KILLED_CODE })
    expect(Math.max(...seconds)).toBeLessThanOrEqual(11)
    expect(toolFailure(tooLong, 'CONVERSION_FAILED').code).toBe('TOO_LONG')
  })

  it.skipIf(!hasPrlimit)('mémoire bornée par prlimit (Linux) : limite trop basse → échec, 4 Gio → succès', async () => {
    expect((await runTool(FFMPEG, { args: ['-hide_banner', '-version'], timeoutMs: 10_000, memoryLimit: 16 * 1024 * 1024 })).code).not.toBe(0)
    expect((await runTool(FFMPEG, { args: ['-hide_banner', '-version'], timeoutMs: 10_000, memoryLimit: 4 * GIB })).code).toBe(0)
  })

  describe('fichier hostile : liste HLS déguisée en AVI', () => {
    const hits: string[] = []
    const server = createServer((request, response) => {
      hits.push(request.url ?? '')
      response.statusCode = 404
      response.end()
    })
    let url: string

    beforeAll(async () => {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/segment.ts`
    })
    afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

    const playlist = (target: string) => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10.0,\n${target}\n#EXT-X-ENDLIST\n`

    it('URL locale et fichiers du serveur : échec propre, aucune requête, rien de lu ni produit', async () => {
      // Segment local lisible : s'il était ouvert, ses images se retrouveraient dans la sortie.
      const secret = file('secret.ts')
      await generate(secret, [...video('160x90', 10, 1), ...X264, '-f', 'mpegts'])
      const targets = { http: url, local: `file:${secret}`, passwd: 'file:///etc/passwd' }
      // Chaque liste sous deux noms : « .avi » (l'attaque connue) et « .m3u8 », que ffmpeg reconnaîtrait
      // d'après son nom s'il devinait le format (le nom des fichiers de travail ne doit rien protéger).
      const inputs: string[] = []
      for (const [name, target] of Object.entries(targets)) {
        for (const extension of ['avi', 'm3u8']) {
          inputs.push(file(`hostile-${name}.${extension}`))
          await writeFile(inputs.at(-1)!, playlist(target))
        }
      }

      // Témoins, hors des protections : format deviné et HTTP permis → requête au serveur ; liste locale
      // → segment lu. Les tests suivants ont donc de quoi voir une fuite.
      await execFileResult(FFPROBE, ['-v', 'error', '-protocol_whitelist', 'file,http,tcp', '-show_format', file('hostile-http.m3u8')])
      expect(hits.length).toBeGreaterThan(0)
      const witness = await execFileResult(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', file('hostile-local.m3u8')])
      expect(witness.stdout).toContain('"codec_name": "h264"')
      hits.length = 0

      await Promise.all(inputs.map(async (input, index) => {
        await expect(runFfprobe(settings, 'avi', input)).rejects.toMatchObject({ code: 'UNREADABLE' })
        // Quel que soit le format imposé, jamais la liste HLS.
        await Promise.all((Object.keys(INPUT_FORMATS) as VideoContainer[]).map(container =>
          expect(runFfprobe(settings, container, input)).rejects.toBeInstanceOf(VideoToolError)))
        const output = file(`hostile-${index}.mp4`)
        const result = await runTool(FFMPEG, {
          args: h264Args({ input, container: 'avi', output, threads: 1, preset: 'ultrafast', crf: 30, streams: { video: 0, audio: null }, target: { width: 160, height: 90 }, fps: null, toneMap: null }),
          timeoutMs: 30_000,
        })
        expect(result.code).not.toBe(0)
        expect(result.timedOut).toBe(false)
        expect(await exists(output)).toBe(false)
        const poster = file(`hostile-${index}.jpg`)
        expect((await runTool(FFMPEG, { args: posterArgs({ input, container: 'mkv', output: poster, threads: 1, video: 0, time: 1, width: 160, height: 90, toneMap: null }), timeoutMs: 30_000 })).code).not.toBe(0)
        expect(await exists(poster)).toBe(false)
      }))
      expect(hits).toEqual([])
    })
  })
})
