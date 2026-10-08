import { describe, expect, it } from 'vitest'
import { videoMetadata, type VideoContainer, VIDEO_CONTAINERS, type VideoMetadata } from '../shared/utils/video'
import {
  apiProcessingStatus,
  deliveryHeld,
  JOB_MAX_ATTEMPTS,
  JOB_TEXT_MAX,
  retryDelay,
  truncateText,
} from '../shared/utils/video-processing'
import {
  av1Args,
  boundedThreads,
  DEINTERLACE_FILTER,
  type EncodeOptions,
  ffprobeArgs,
  fileUrl,
  h264Args,
  INPUT_FORMATS,
  MAX_DECODED_PIXELS,
  MAX_OUTPUT_SIZE,
  MAX_THREADS,
  posterArgs,
  posterDimensions,
  renditionFilters,
  sanitizeArgs,
  toneMapFilter,
  webmCopyable,
  webmRepairArgs,
} from '../server/lib/video-processing/args'
import { evaluateCapabilities, ffmpegProblemMessage, FFMPEG_PROBLEMS, parseEncoders, parseFfmpegVersion, parseFilters } from '../server/lib/video-processing/ffmpeg'
import { normalizeAudioCodec, normalizeVideoCodec, parseFfprobe, type ProbeResult } from '../server/lib/video-processing/ffprobe'
import { frameLuminance, type PlanInput, planVideoJob, posterTimes, scaledDimensions } from '../server/lib/video-processing/plan'
import {
  ENCODE_TIMEOUT_MAX_MS,
  encodeTimeoutMs,
  parseProgressBlock,
  parseProgressLine,
  stderrSummary,
  toolEnvironment,
  toolFailure,
  type RunResult,
  VideoToolError,
} from '../server/lib/video-processing/run'
import { resolveVideoProcessingSettings } from '../server/lib/video-processing/settings'

/**
 * Traitement des vidéos (phase D3) sans ffmpeg : réglages, détection (lecture des sorties), arguments
 * (règles de sécurité du § 36), progression, analyse ffprobe (JSON), plan d'une tâche. Les mêmes
 * fonctions sont exécutées sur de vrais fichiers dans video-ffmpeg.test.ts (quand ffmpeg est présent).
 */

// ─── Réglages et règles partagées (fondation) ────────────────────────────────

describe('resolveVideoProcessingSettings', () => {
  it('valeurs par défaut : traitement désactivé, rôle web, moitié des cœurs, 4 Gio', () => {
    const warnings: string[] = []
    const settings = resolveVideoProcessingSettings({}, 8, message => warnings.push(message))
    expect(settings).toEqual({
      mode: 'off',
      role: 'web',
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      concurrency: 1,
      threads: 4,
      rendition: 'auto',
      preset: 'veryfast',
      crf: 23,
      av1: false,
      maxDuration: 10_800,
      memoryLimit: 4096 * 1024 * 1024,
    })
    expect(warnings).toEqual([])
    expect(resolveVideoProcessingSettings({}, 1).threads).toBe(1)
  })

  it('valeurs converties par destr (nombres, booléens) et chaînes sans casse', () => {
    const settings = resolveVideoProcessingSettings({
      serverRole: 'Worker',
      ffmpegPath: ' /opt/ffmpeg/bin/ffmpeg ',
      video: { processing: 'EXTERNAL', concurrency: 2, threads: '3', rendition: 'always', preset: 'medium', crf: '28', av1: true, maxDuration: 600, memoryLimit: 0 },
    }, 8)
    expect(settings).toMatchObject({
      mode: 'external',
      role: 'worker',
      ffmpegPath: '/opt/ffmpeg/bin/ffmpeg',
      concurrency: 2,
      threads: 3,
      rendition: 'always',
      preset: 'medium',
      crf: 28,
      av1: true,
      maxDuration: 600,
      memoryLimit: null,
    })
    for (const value of ['on', '1', 'yes', 'TRUE']) expect(resolveVideoProcessingSettings({ video: { av1: value } }, 4).av1).toBe(true)
    for (const value of ['off', '0', 'no', false]) expect(resolveVideoProcessingSettings({ video: { av1: value } }, 4).av1).toBe(false)
  })

  it('valeur invalide : défaut avec un avertissement, jamais d\'erreur', () => {
    const warnings: string[] = []
    const settings = resolveVideoProcessingSettings({
      serverRole: 'admin',
      video: { processing: 'cloud', concurrency: 0, threads: -1, rendition: 'sometimes', preset: 'turbo', crf: 52, av1: 'maybe', maxDuration: 1.5 },
    }, 4, message => warnings.push(message))
    expect(settings).toMatchObject({ mode: 'off', role: 'web', concurrency: 1, threads: 2, rendition: 'auto', preset: 'veryfast', crf: 23, av1: false, maxDuration: 10_800 })
    expect(warnings).toHaveLength(9)
    expect(warnings.some(message => message.startsWith('NUXT_VIDEO_PROCESSING : valeur « cloud »'))).toBe(true)
  })
})

describe('règles partagées de la file et de la diffusion', () => {
  it('retryDelay : 30 s, 5 min, puis échec définitif au 3e essai', () => {
    expect(retryDelay(1)).toBe(30_000)
    expect(retryDelay(2)).toBe(300_000)
    expect(retryDelay(JOB_MAX_ATTEMPTS)).toBeNull()
    expect(retryDelay(0)).toBe(30_000)
  })

  it('truncateText : 191 caractères au plus, points de suspension compris', () => {
    expect(truncateText('court')).toBe('court')
    const long = truncateText('x'.repeat(500))
    expect(long).toHaveLength(JOB_TEXT_MAX)
    expect(long.endsWith('…')).toBe(true)
    expect(truncateText('abcdef', 4)).toBe('abc…')
  })

  it('apiProcessingStatus : état en minuscules', () => {
    expect(apiProcessingStatus('PENDING')).toBe('pending')
    expect(apiProcessingStatus('READY')).toBe('ready')
  })

  it('deliveryHeld : vidéo avec piste de données, en attente ou en cours, traitement actif', () => {
    const media = { kind: 'VIDEO', processingState: 'PENDING' as const, metadata: { dataTracks: ['gpmd'] } }
    expect(deliveryHeld(media, 'embedded')).toBe(true)
    expect(deliveryHeld({ ...media, processingState: 'PROCESSING' }, 'external')).toBe(true)
    expect(deliveryHeld(media, 'off')).toBe(false)
    expect(deliveryHeld({ ...media, processingState: 'READY' }, 'embedded')).toBe(false)
    expect(deliveryHeld({ ...media, processingState: 'FAILED' }, 'embedded')).toBe(false)
    expect(deliveryHeld({ ...media, processingState: null }, 'embedded')).toBe(false)
    expect(deliveryHeld({ ...media, metadata: { dataTracks: [] } }, 'embedded')).toBe(false)
    expect(deliveryHeld({ ...media, metadata: null }, 'embedded')).toBe(false)
    expect(deliveryHeld({ ...media, kind: 'IMAGE' }, 'embedded')).toBe(false)
  })
})

// ─── Détection de ffmpeg ─────────────────────────────────────────────────────

const VERSION_UBUNTU = `ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers
built with gcc 13 (Ubuntu 13.2.0-23ubuntu3)
configuration: --prefix=/usr --enable-gpl --enable-libx264
libavutil      58. 29.100 / 58. 29.100
libavcodec     60. 31.102 / 60. 31.102
libavformat    60. 16.100 / 60. 16.100
`
const VERSION_GIT = `ffmpeg version 2024-10-10-git-0f5592cfc7-full_build-www.gyan.dev Copyright (c) 2000-2024 the FFmpeg developers
built with gcc 14.2.0 (Rev1, Built by MSYS2 project)
libavutil      59. 39.100 / 59. 39.100
libavformat    61.  9.100 / 61.  9.100
`
const ENCODERS = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V..... libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)
 VFS... mjpeg                MJPEG (Motion JPEG)
 A....D aac                  AAC (Advanced Audio Coding)
 A....D libopus              libopus Opus (codec opus)
 S..... mov_text             3GPP Timed Text subtitle
`
const FILTERS = `Filters:
  T.. = Timeline support
  .S. = Slice threading
  | = Source or sink filter
 ... abench            A->A       Benchmark part of a filtergraph.
 TSC scale             V->V       Scale the input video size and/or convert the image format.
 .S. tonemap           V->V       Conversion to/from different dynamic ranges.
 .SC zscale            V->V       Apply resizing, colorspace and bit depth conversion.
 ... testsrc2          |->V       Generate another test pattern.
`

describe('détection de ffmpeg', () => {
  it('parseFfmpegVersion : numéro publié, version de développement (libavformat), sortie étrangère', () => {
    expect(parseFfmpegVersion(VERSION_UBUNTU)).toEqual({ version: '6.1.1-3ubuntu5', major: 6 })
    expect(parseFfmpegVersion('ffmpeg version n7.0.2 Copyright (c) 2000-2024')).toEqual({ version: 'n7.0.2', major: 7 })
    expect(parseFfmpegVersion('ffmpeg version 7.1-full_build-www.gyan.dev Copyright')).toEqual({ version: '7.1-full_build-www.gyan.dev', major: 7 })
    expect(parseFfmpegVersion(VERSION_GIT)).toEqual({ version: '2024-10-10-git-0f5592cfc7-full_build-www.gyan.dev', major: 7 })
    expect(parseFfmpegVersion('ffmpeg version N-117435-g1a7d0b5a8b-20241008 Copyright')).toEqual({ version: 'N-117435-g1a7d0b5a8b-20241008', major: null })
    expect(parseFfmpegVersion('ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright')?.major).toBe(4)
    expect(parseFfmpegVersion('avconv version 12')).toBeNull()
    expect(parseFfmpegVersion('')).toBeNull()
  })

  it('parseEncoders et parseFilters : noms seulement, légendes ignorées', () => {
    expect([...parseEncoders(ENCODERS)]).toEqual(['libx264', 'libsvtav1', 'mjpeg', 'aac', 'libopus', 'mov_text'])
    expect([...parseFilters(FILTERS)]).toEqual(['abench', 'scale', 'tonemap', 'zscale', 'testsrc2'])
    expect(parseEncoders('').size).toBe(0)
  })

  it('evaluateCapabilities : tout présent', () => {
    expect(evaluateCapabilities({ version: VERSION_UBUNTU, encoders: ENCODERS, filters: FILTERS, ffprobe: 'ffprobe version 6.1.1' })).toEqual({
      ok: true,
      version: '6.1.1-3ubuntu5',
      major: 6,
      encoders: ['libx264', 'aac', 'libsvtav1', 'libopus'],
      hdrFilters: true,
      av1: true,
      problems: [],
    })
  })

  it('evaluateCapabilities : ffmpeg ou ffprobe absents, trop ancien, encodeurs manquants', () => {
    expect(evaluateCapabilities({ version: null, encoders: null, filters: null, ffprobe: null })).toMatchObject({
      ok: false, version: null, problems: ['ffmpeg_unavailable', 'ffprobe_unavailable'],
    })
    const old = evaluateCapabilities({ version: 'ffmpeg version 5.1.6-0+deb12u1 Copyright', encoders: ' ------\n A....D aac   AAC\n', filters: '', ffprobe: null })
    expect(old).toMatchObject({ ok: false, major: 5, encoders: ['aac'], hdrFilters: false, av1: false })
    expect(old.problems).toEqual(['ffmpeg_outdated', 'ffprobe_unavailable', 'libx264_missing'])
    // Version de développement sans libavformat lisible : acceptée.
    expect(evaluateCapabilities({ version: 'ffmpeg version N-1-gabc', encoders: ENCODERS, filters: 'Filters:\n TSC scale V->V x\n', ffprobe: 'x' })).toMatchObject({ ok: true, major: null, hdrFilters: false, av1: true })
  })

  it('chaque problème a un message de journal', () => {
    for (const problem of FFMPEG_PROBLEMS) expect(ffmpegProblemMessage(problem)).toMatch(/\S/)
  })
})

// ─── Lancement : progression, délais, environnement, erreurs ─────────────────

describe('lancement des outils', () => {
  it('parseProgressLine et parseProgressBlock : out_time_us, puis out_time_ms (µs), puis out_time', () => {
    expect(parseProgressLine('out_time_us=1500000')).toEqual({ key: 'out_time_us', value: '1500000' })
    expect(parseProgressLine('bitrate= 392.7kbits/s')).toEqual({ key: 'bitrate', value: '392.7kbits/s' })
    expect(parseProgressLine('progress')).toBeNull()
    expect(parseProgressLine('=x')).toBeNull()
    const block = 'frame=30\nfps=0.00\ntotal_size=48177\nout_time_us=981333\nout_time_ms=981333\nout_time=00:00:00.981333\nspeed=4.61x\nprogress=continue\n'
    expect(parseProgressBlock(block)).toBeCloseTo(0.981333, 6)
    expect(parseProgressBlock('out_time_ms=2500000\r\nprogress=end')).toBe(2.5)
    expect(parseProgressBlock('out_time=01:02:03.250000')).toBeCloseTo(3723.25, 6)
    // Début d'un encodage : valeurs inconnues ou négatives.
    expect(parseProgressBlock('out_time_us=N/A\nout_time=N/A\nprogress=continue')).toBeNull()
    expect(parseProgressBlock('out_time_us=-23219\nprogress=continue')).toBeNull()
    expect(parseProgressBlock('out_time=-00:00:00.023219')).toBeNull()
  })

  it('encodeTimeoutMs : 10 × la durée + 120 s, plafonné ; durée inconnue : celle de la plus longue vidéo acceptée', () => {
    expect(encodeTimeoutMs(60, 10_800)).toBe(720_000)
    expect(encodeTimeoutMs(1.5, 10_800)).toBe(135_000)
    expect(encodeTimeoutMs(10_800, 10_800)).toBe(ENCODE_TIMEOUT_MAX_MS)
    expect(encodeTimeoutMs(null, 10_800)).toBe(ENCODE_TIMEOUT_MAX_MS)
    // Limite abaissée (NUXT_VIDEO_MAX_DURATION=600) : un fichier sans durée n'occupe plus 24 h.
    expect(encodeTimeoutMs(null, 600)).toBe(6_120_000)
    expect(encodeTimeoutMs(Number.NaN, 600)).toBe(6_120_000)
    expect(encodeTimeoutMs(0, 60)).toBe(720_000)
  })

  it('toolEnvironment : ni secrets ni mandataires, chemins gardés (casse de Windows comprise)', () => {
    const env = toolEnvironment({
      PATH: '/usr/bin',
      Path: 'C:\\Windows',
      SystemRoot: 'C:\\Windows',
      LD_LIBRARY_PATH: '/opt/lib',
      NUXT_MEDIA_SIGNING_SECRET: 'secret',
      DATABASE_URL: 'postgres://user:password@db/surge',
      AWS_SECRET_ACCESS_KEY: 'key',
      http_proxy: 'http://proxy:3128',
      HTTPS_PROXY: 'http://proxy:3128',
      HOME: '/root',
    })
    expect(env).toEqual({ PATH: '/usr/bin', Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', LD_LIBRARY_PATH: '/opt/lib', SVT_LOG: '1', MALLOC_ARENA_MAX: '2' })
  })

  it('stderrSummary : dernières lignes, chemins du serveur retirés, 191 caractères au plus', () => {
    const stderr = [
      '[mov,mp4,m4a,3gp,3g2,mj2 @ 0x55] moov atom not found',
      'file:/var/lib/surge/tmp/job-abc/source.mp4: Invalid data found when processing input',
      'Error opening input file C:\\Users\\Admin\\AppData\\Local\\Temp\\job\\source.mov.',
      'Error opening input files: Invalid data found when processing input',
      '',
    ].join('\n')
    const summary = stderrSummary(stderr)
    expect(summary).not.toMatch(/var|surge|job-abc|Users|Admin|AppData/)
    expect(summary).toBe('…: Invalid data found when processing input | Error opening input file … | Error opening input files: Invalid data found when processing input')
    expect(stderrSummary('frame rate 30/1 and 1/30 time base')).toBe('frame rate 30/1 and 1/30 time base')
    expect(stderrSummary('x'.repeat(1000))).toHaveLength(JOB_TEXT_MAX)
    expect(stderrSummary('')).toBe('')
  })

  it('stderrSummary : chemins connus masqués en entier, espaces compris (dossier de l\'utilisateur Windows, stockage)', () => {
    const input = '/srv/surge media/storage/originals/ab/cd.mp4'
    const output = 'C:\\Users\\Jean Dupont\\AppData\\Local\\Temp\\surge-job-1\\h264.mp4'
    const stderr = [
      'Error opening input file C:\\Users\\Jean Dupont\\AppData\\Local\\Temp\\surge-job-1\\source.mov.',
      `file:${input}: Invalid data found when processing input`,
      `[out#0/mp4 @ 0x5] Error opening output ${output}: Permission denied`,
    ].join('\n')
    // Sans les chemins : le motif générique s'arrête au premier espace (ce qu'il reste à protéger).
    expect(stderrSummary(stderr)).toMatch(/Dupont|media/)
    const summary = stderrSummary(stderr, [input, output])
    expect(summary).not.toMatch(/Jean|Dupont|AppData|surge|media|storage|originals|job/)
    // Dossier de la tâche (celui de la sortie) masqué aussi avec un autre fichier (l'entrée copiée).
    expect(summary).toBe('Error opening input file … | …: Invalid data found when processing input | [out#0/mp4 @ 0x5] Error opening output …: Permission denied')
    // Dossier racine jamais masqué seul (il masquerait des mots ordinaires).
    expect(stderrSummary('No space left on /tmp', ['/tmp/source.mov'])).toBe('No space left on /tmp')
  })

  it('toolFailure : délai → TIMEOUT, sortie trop longue → TOO_LONG, sinon le code demandé avec un résumé sans les chemins de la commande', () => {
    const base: RunResult = { code: 1, signal: null, stdout: '', stderrTail: '/tmp/x/in.avi: Invalid data found', timedOut: false, aborted: false, overflow: false, tooLong: false, paths: [] }
    const failure = toolFailure(base, 'UNREADABLE')
    expect(failure).toBeInstanceOf(VideoToolError)
    expect(failure.code).toBe('UNREADABLE')
    expect(failure.message).toBe('code 1 : …: Invalid data found')
    expect(toolFailure({ ...base, code: null, signal: 'SIGKILL', timedOut: true }, 'CONVERSION_FAILED').code).toBe('TIMEOUT')
    expect(toolFailure({ ...base, code: null, signal: 'SIGKILL', tooLong: true }, 'CONVERSION_FAILED').code).toBe('TOO_LONG')
    expect(toolFailure({ ...base, code: null, signal: 'SIGKILL', stderrTail: '' }, 'CONVERSION_FAILED').message).toBe('signal SIGKILL')
    expect(toolFailure({ ...base, overflow: true }, 'UNREADABLE').code).toBe('UNREADABLE')
    const spaced = { ...base, stderrTail: 'file:/var/lib/surge media/job 1/in.avi: Invalid data found', paths: ['/var/lib/surge media/job 1/in.avi'] }
    expect(toolFailure(spaced, 'UNREADABLE').message).toBe('code 1 : …: Invalid data found')
  })
})

// ─── Arguments (sécurité du § 36) ────────────────────────────────────────────

const INPUT = '/tmp/job/source.bin'
const OUTPUT = '/tmp/job/output.bin'

const encode = (container: VideoContainer, overrides: Partial<EncodeOptions> = {}): EncodeOptions => ({
  input: INPUT,
  container,
  output: OUTPUT,
  threads: 2,
  streams: { video: 0, audio: 1 },
  target: { width: 1920, height: 1080 },
  fps: 30,
  toneMap: null,
  ...overrides,
})

/** Toutes les commandes possibles pour un conteneur donné. */
function commandsFor(container: VideoContainer): string[][] {
  const commands = [
    ffprobeArgs(container, INPUT),
    h264Args({ ...encode(container), preset: 'veryfast', crf: 23 }),
    av1Args(encode(container)),
    posterArgs({ input: INPUT, container, output: OUTPUT, threads: 2, video: 0, time: 1.5, width: 1920, height: 1080, toneMap: 'hlg' }),
  ]
  if (container === 'mp4' || container === 'mov' || container === '3gp') commands.push(sanitizeArgs({ input: INPUT, container, output: OUTPUT, video: 0, audio: [1] }))
  if (container === 'webm') commands.push(webmRepairArgs({ input: INPUT, output: OUTPUT, video: 0, audio: [1] }))
  return commands
}

/** Valeur qui suit une option (dernière occurrence avant `before`). */
function optionValue(args: string[], option: string, before = args.length): string | undefined {
  const index = args.lastIndexOf(option, before - 1)
  return index === -1 ? undefined : args[index + 1]
}

describe('arguments de ffmpeg et ffprobe', () => {
  it('format d\'entrée imposé pour chaque conteneur, jamais un démultiplexeur qui ouvre d\'autres fichiers', () => {
    expect(INPUT_FORMATS).toEqual({ mp4: 'mov', mov: 'mov', '3gp': 'mov', webm: 'matroska', mkv: 'matroska', avi: 'avi', ts: 'mpegts', ogv: 'ogg', wmv: 'asf' })
    expect(Object.keys(INPUT_FORMATS).sort()).toEqual([...VIDEO_CONTAINERS].sort())
    for (const format of Object.values(INPUT_FORMATS)) expect(['hls', 'applehttp', 'concat', 'dash', 'image2', 'tee', 'lavfi']).not.toContain(format)
  })

  it('règles communes : entrée unique précédée du protocole et du format, sortie absolue, aucune entrée clavier', () => {
    for (const container of VIDEO_CONTAINERS) {
      for (const args of commandsFor(container)) {
        const input = args.indexOf('-i')
        expect(input).toBeGreaterThan(0)
        expect(args.lastIndexOf('-i')).toBe(input)
        expect(args[input + 1]).toBe(`file:${INPUT}`)
        // Options d'entrée : avant `-i`, sinon ffmpeg les appliquerait à la sortie.
        expect(optionValue(args, '-protocol_whitelist', input)).toBe('file')
        expect(args.indexOf('-protocol_whitelist')).toBe(args.lastIndexOf('-protocol_whitelist'))
        expect(optionValue(args, '-f', input)).toBe(INPUT_FORMATS[container])
        expect(optionValue(args, '-max_pixels', input)).toBe(String(MAX_DECODED_PIXELS))
        expect(args.includes('-enable_drefs')).toBe(INPUT_FORMATS[container] === 'mov')
        expect(args.join(' ')).not.toMatch(/https?:|concat|crypto|subfile|pipe:0|-safe/)
        if (args[0] === '-v') continue // ffprobe : rien d'autre à vérifier, aucune sortie de fichier
        expect(args.slice(0, 5)).toEqual(['-nostdin', '-hide_banner', '-loglevel', 'error', '-filter_threads'])
        expect(args.at(-1)).toBe(`file:${OUTPUT}`)
        expect(args.at(-2)).toBe('-y')
        expect(optionValue(args, '-f')).toMatch(/^(mp4|mov|webm|image2)$/)
        expect(Number(optionValue(args, '-fs'))).toBeLessThanOrEqual(MAX_OUTPUT_SIZE)
        expect(optionValue(args, '-max_muxing_queue_size')).toBe('1024')
      }
    }
  })

  it('chemins relatifs refusés (ffmpeg les résoudrait depuis son dossier courant)', () => {
    expect(fileUrl('/tmp/a b/c.mp4')).toBe('file:/tmp/a b/c.mp4')
    expect(() => fileUrl('source.mp4')).toThrow()
    expect(() => ffprobeArgs('mp4', 'http://example.com/x.mp4')).toThrow()
    expect(() => h264Args({ ...encode('mkv', { output: 'out.mp4' }), preset: 'veryfast', crf: 23 })).toThrow()
  })

  it('ffprobe : JSON des flux et du format', () => {
    expect(ffprobeArgs('mkv', INPUT)).toEqual([
      '-v', 'error', '-hide_banner', '-max_pixels', String(MAX_DECODED_PIXELS), '-protocol_whitelist', 'file', '-f', 'matroska',
      '-print_format', 'json', '-show_format', '-show_streams', '-i', `file:${INPUT}`,
    ])
  })

  it('H.264 : High 8 bits, CRF et préréglage, image clé toutes les 2 s, AAC stéréo 48 kHz, faststart, sans métadonnées d\'origine', () => {
    const args = h264Args({ ...encode('mov', { threads: 3 }), preset: 'medium', crf: 20 })
    const input = args.indexOf('-i')
    expect(optionValue(args, '-threads', input)).toBe('3')
    expect(args.slice(input + 2, input + 12)).toEqual(['-map', '0:0', '-map', '0:1', '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn'])
    expect(optionValue(args, '-vf')).toBe(`${DEINTERLACE_FILTER},scale=1920:1080,setsar=1,format=yuv420p`)
    expect(optionValue(args, '-c:v')).toBe('libx264')
    expect(optionValue(args, '-preset')).toBe('medium')
    expect(optionValue(args, '-crf')).toBe('20')
    expect(optionValue(args, '-profile:v')).toBe('high')
    expect(optionValue(args, '-pix_fmt')).toBe('yuv420p')
    expect(optionValue(args, '-fpsmax')).toBe('60')
    expect(optionValue(args, '-g')).toBe('60')
    expect(optionValue(args, '-force_key_frames')).toBe('expr:gte(t,n_forced*2)')
    expect(optionValue(args, '-threads')).toBe('3')
    expect(args.indexOf('-threads', input)).toBeGreaterThan(input)
    expect(optionValue(args, '-c:a')).toBe('aac')
    expect(optionValue(args, '-b:a')).toBe('128k')
    expect(optionValue(args, '-ac')).toBe('2')
    expect(optionValue(args, '-ar')).toBe('48000')
    expect(optionValue(args, '-movflags')).toBe('+faststart')
    expect(optionValue(args, '-progress')).toBe('pipe:1')
    expect(args).toContain('-nostats')
    expect(optionValue(args, '-f')).toBe('mp4')
    expect(args).not.toContain('-an')
    expect(args).not.toContain('-color_trc')
  })

  it('H.264 : sans son, cadence plafonnée au-delà de 60 i/s, conversion HDR et couleurs BT.709', () => {
    const silent = h264Args({ ...encode('mkv', { streams: { video: 2, audio: null }, fps: 120, target: { width: 1080, height: 1920 } }), preset: 'veryfast', crf: 23 })
    expect(silent).toContain('-an')
    expect(silent).not.toContain('-c:a')
    expect(silent.filter(arg => arg === '-map')).toHaveLength(1)
    expect(optionValue(silent, '-map')).toBe('0:2')
    expect(optionValue(silent, '-vf')).toBe(`${DEINTERLACE_FILTER},fps=60,scale=1080:1920,setsar=1,format=yuv420p`)
    expect(optionValue(silent, '-g')).toBe('120')

    const hdr = h264Args({ ...encode('mov', { toneMap: 'pq', fps: 24 }), preset: 'veryfast', crf: 23 })
    expect(optionValue(hdr, '-vf')).toBe(`${DEINTERLACE_FILTER},scale=1920:1080,setsar=1,${toneMapFilter('pq')}`)
    expect(optionValue(hdr, '-g')).toBe('48')
    expect(optionValue(hdr, '-color_primaries')).toBe('bt709')
    expect(optionValue(hdr, '-color_trc')).toBe('bt709')
    expect(optionValue(hdr, '-colorspace')).toBe('bt709')
  })

  it('cadence inconnue (WebM et MKV des navigateurs, 1000 i/s annoncés) : sortie bornée à 60 i/s, image clé toutes les 120 images', () => {
    // Sans `-fpsmax`, le MP4 (cadence constante) dupliquerait les images jusqu'à 1000 i/s, et SVT-AV1
    // refuse tout au-delà de 240 i/s (vérifié sur les enregistrements dans video-ffmpeg.test.ts).
    for (const args of [h264Args({ ...encode('webm', { fps: null }), preset: 'veryfast', crf: 23 }), av1Args(encode('mkv', { fps: null }))]) {
      expect(optionValue(args, '-fpsmax')).toBe('60')
      expect(args.indexOf('-fpsmax')).toBeGreaterThan(args.indexOf('-i'))
      expect(optionValue(args, '-g')).toBe('120')
      expect(optionValue(args, '-vf')).not.toContain('fps=')
    }
  })

  it('fils bornés à 16 (décodage, filtres, encodage) : mémoire tenue sous la limite par défaut', () => {
    expect(MAX_THREADS).toBe(16)
    expect([boundedThreads(64), boundedThreads(16), boundedThreads(3.7), boundedThreads(0), boundedThreads(Number.NaN)]).toEqual([16, 16, 3, 1, 1])
    const args = h264Args({ ...encode('mov', { threads: 64 }), preset: 'veryfast', crf: 23 })
    const values = args.flatMap((arg, index) => arg === '-threads' || arg === '-filter_threads' ? [args[index + 1]] : [])
    expect(values).toEqual(['16', '16', '16'])
    expect(optionValue(av1Args(encode('mov', { threads: 64 })), '-threads')).toBe('16')
    expect(optionValue(posterArgs({ input: INPUT, container: 'mov', output: OUTPUT, threads: 48, video: 0, time: 1, width: 640, height: 360, toneMap: null }), '-threads')).toBe('16')
  })

  it('filtres : désentrelacement image par image en tête, 60 i/s exactement non touché, HLG et PQ d\'après la courbe détectée', () => {
    expect(DEINTERLACE_FILTER).toBe('bwdif=mode=send_frame:parity=auto:deint=interlaced')
    expect(renditionFilters({ target: { width: 640, height: 360 }, fps: 60, toneMap: null })).toBe(`${DEINTERLACE_FILTER},scale=640:360,setsar=1,format=yuv420p`)
    expect(renditionFilters({ target: { width: 640, height: 360 }, fps: 59.94, toneMap: null })).not.toContain('fps=')
    expect(toneMapFilter('hlg')).toBe('zscale=tin=arib-std-b67:pin=bt2020:min=bt2020nc:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p')
    expect(toneMapFilter('pq')).toMatch(/^zscale=tin=smpte2084:/)
  })

  it('AV1 : SVT-AV1 préréglage 10 CRF 35, parallélisme borné, Opus 96 kbit/s, WebM', () => {
    const args = av1Args(encode('mp4', { threads: 12 }))
    expect(optionValue(args, '-c:v')).toBe('libsvtav1')
    expect(optionValue(args, '-preset')).toBe('10')
    expect(optionValue(args, '-crf')).toBe('35')
    expect(optionValue(args, '-svtav1-params')).toBe('lp=6')
    expect(optionValue(av1Args(encode('mp4', { threads: 2 })), '-svtav1-params')).toBe('lp=2')
    expect(optionValue(args, '-c:a')).toBe('libopus')
    expect(optionValue(args, '-b:a')).toBe('96k')
    expect(optionValue(args, '-f')).toBe('webm')
    expect(args).not.toContain('-movflags')
    expect(args).toContain('-progress')
    expect(av1Args(encode('mp4', { streams: { video: 0, audio: null } }))).toContain('-an')
  })

  it('affiche : déplacement avant le décodage, une image JPEG ≤ 3840 px, conversion HDR', () => {
    const args = posterArgs({ input: INPUT, container: 'mov', output: OUTPUT, threads: 1, video: 0, time: 2.5, width: 2160, height: 3840, toneMap: 'hlg' })
    const input = args.indexOf('-i')
    expect(optionValue(args, '-ss', input)).toBe('2.5')
    expect(args.indexOf('-ss')).toBeLessThan(input)
    expect(optionValue(args, '-map')).toBe('0:0')
    expect(optionValue(args, '-frames:v')).toBe('1')
    expect(optionValue(args, '-q:v')).toBe('2')
    expect(optionValue(args, '-update')).toBe('1')
    expect(optionValue(args, '-f')).toBe('image2')
    expect(optionValue(args, '-vf')).toBe(`${DEINTERLACE_FILTER},scale=2160:3840,setsar=1,${toneMapFilter('hlg')}`)
    expect(args).toEqual(expect.arrayContaining(['-an', '-sn', '-dn']))
    // Instant 0 : aucun déplacement ; image 8K ramenée à 3840 px.
    const start = posterArgs({ input: INPUT, container: 'mkv', output: OUTPUT, threads: 1, video: 1, time: 0, width: 7680, height: 4320, toneMap: null })
    expect(start).not.toContain('-ss')
    expect(optionValue(start, '-vf')).toBe(`${DEINTERLACE_FILTER},scale=3840:2160,setsar=1`)
    expect(posterDimensions(1000, 501)).toEqual({ width: 1000, height: 501 })
    expect(posterDimensions(5000, 3)).toEqual({ width: 3840, height: 2 })
  })

  it('retrait des pistes de données : copie de la vidéo principale et des sons identifiés, MP4 → MP4, MOV et 3GP → MOV', () => {
    const args = sanitizeArgs({ input: INPUT, container: 'mp4', output: OUTPUT, video: 1, audio: [0, 3] })
    const input = args.indexOf('-i')
    expect(args.slice(input + 2, args.indexOf('-max_muxing_queue_size'))).toEqual([
      '-map', '0:1', '-map', '0:0', '-map', '0:3', '-c', 'copy', '-map_metadata', '0', '-map_chapters', '-1', '-sn', '-dn',
    ])
    expect(optionValue(args, '-f')).toBe('mp4')
    expect(optionValue(sanitizeArgs({ input: INPUT, container: 'mov', output: OUTPUT, video: 0, audio: [] }), '-f')).toBe('mov')
    expect(optionValue(sanitizeArgs({ input: INPUT, container: '3gp', output: OUTPUT, video: 0, audio: [] }), '-f')).toBe('mov')
    expect(sanitizeArgs({ input: INPUT, container: 'mov', output: OUTPUT, video: 0, audio: [] }).filter(arg => arg === '-map')).toHaveLength(1)
    expect(args).not.toContain('-c:v')
  })

  it('réparation WebM : copie de la vidéo principale et des sons identifiés vers WebM', () => {
    const args = webmRepairArgs({ input: INPUT, output: OUTPUT, video: 1, audio: [0, 2] })
    expect(optionValue(args, '-f', args.indexOf('-i'))).toBe('matroska')
    expect(args.slice(args.indexOf('-i') + 2, args.indexOf('-max_muxing_queue_size'))).toEqual(['-map', '0:1', '-map', '0:0', '-map', '0:2', '-c', 'copy', '-map_chapters', '-1', '-sn', '-dn'])
    expect(optionValue(args, '-f')).toBe('webm')
    expect(webmRepairArgs({ input: INPUT, output: OUTPUT, video: 0, audio: [] }).filter(arg => arg === '-map')).toHaveLength(1)
  })

  it('webmCopyable : VP8, VP9, AV1 avec Opus, Vorbis ou sans son ; jamais le H.264 ni le PCM d\'un WebM de Chrome', () => {
    expect(webmCopyable('vp8', [])).toBe(true)
    expect(webmCopyable('vp9', ['opus'])).toBe(true)
    expect(webmCopyable('vp09', ['vorbis', 'opus'])).toBe(true)
    expect(webmCopyable('av01', ['opus'])).toBe(true)
    expect(webmCopyable('avc1', ['opus'])).toBe(false)
    expect(webmCopyable('vp9', ['lpcm'])).toBe(false)
    expect(webmCopyable('vp9', ['opus', 'mp4a'])).toBe(false)
  })
})

// ─── Analyse ffprobe ─────────────────────────────────────────────────────────

const stream = (fields: Record<string, unknown>) => ({ disposition: { default: 1, attached_pic: 0 }, ...fields })
const ffprobe = (streams: unknown[], format: Record<string, unknown> = { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.345678', bit_rate: '4000000' }) =>
  JSON.stringify({ streams, format })

/** HEVC 10 bits HLG tourné d'un iPhone (matrice d'affichage −90° pour ffprobe = 90° dans le sens horaire). */
const IPHONE_HLG = ffprobe([
  stream({
    index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'hvc1', width: 1920, height: 1080, sample_aspect_ratio: '1:1',
    pix_fmt: 'yuv420p10le', color_transfer: 'arib-std-b67', color_primaries: 'bt2020', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    side_data_list: [{ side_data_type: 'DOVI configuration record' }, { side_data_type: 'Display Matrix', displaymatrix: '…', rotation: -90 }],
  }),
  stream({ index: 1, codec_type: 'audio', codec_name: 'aac', codec_tag_string: 'mp4a', channels: 2, sample_rate: '44100' }),
  stream({ index: 2, codec_type: 'data', codec_name: 'none', codec_tag_string: 'mebx' }),
  stream({ index: 3, codec_type: 'data', codec_tag_string: 'mebx' }),
  stream({ index: 4, codec_type: 'data', codec_tag_string: 'tmcd' }),
])

describe('parseFfprobe', () => {
  it('vidéo de téléphone : HEVC HLG tourné, son, pistes de métadonnées (codes temporels ignorés)', () => {
    expect(parseFfprobe(IPHONE_HLG)).toEqual({
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: 12.346,
      bitrate: 4_000_000,
      video: { index: 0, codec: 'hvc1', width: 1080, height: 1920, rotation: 90, fps: 30, pixFmt: 'yuv420p10le', bitDepth: 10, hdr: 'hlg', interlaced: false },
      audio: { index: 1, codec: 'mp4a', channels: 2, sampleRate: 44_100 },
      audioStreams: [{ index: 1, codec: 'mp4a', channels: 2, sampleRate: 44_100 }],
      audioIndexes: [1],
      dataStreams: ['mebx'],
    } satisfies ProbeResult)
  })

  it('rotation : matrice d\'affichage (sens trigonométrique) ou ancienne étiquette « rotate »', () => {
    const rotated = (fields: Record<string, unknown>) => parseFfprobe(ffprobe([stream({ index: 0, codec_type: 'video', codec_name: 'h264', width: 640, height: 480, ...fields })])).video
    expect(rotated({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }] })).toMatchObject({ rotation: 270, width: 480, height: 640 })
    expect(rotated({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -180 }] })).toMatchObject({ rotation: 180, width: 640, height: 480 })
    expect(rotated({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: 0 }] })).toMatchObject({ rotation: 0 })
    expect(rotated({ tags: { rotate: '90' } })).toMatchObject({ rotation: 90, width: 480, height: 640 })
    expect(rotated({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -89.9 }] })).toMatchObject({ rotation: 90 })
  })

  it('MKV : pochette ignorée, flux par défaut préféré, pixels non carrés, cadence de base en repli, entrelacé', () => {
    const result = parseFfprobe(ffprobe([
      { index: 0, codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, disposition: { default: 0, attached_pic: 1 } },
      { index: 1, codec_type: 'video', codec_name: 'mpeg2video', codec_tag_string: '[0][0][0][0]', width: 1440, height: 1080, sample_aspect_ratio: '4:3', avg_frame_rate: '0/0', r_frame_rate: '25/1', bits_per_raw_sample: '8', field_order: 'tt', disposition: { default: 0 } },
      { index: 2, codec_type: 'audio', codec_name: 'mp2', disposition: { default: 0 } },
      { index: 3, codec_type: 'audio', codec_name: 'pcm_s16le', channels: 2, sample_rate: '48000', disposition: { default: 1 } },
      { index: 4, codec_type: 'attachment', codec_name: 'ttf' },
      { index: 5, codec_type: 'subtitle', codec_name: 'subrip' },
    ], { format_name: 'matroska,webm', duration: 'N/A' }))
    expect(result.video).toEqual({ index: 1, codec: 'mpeg2video', width: 1920, height: 1080, rotation: 0, fps: 25, pixFmt: null, bitDepth: 8, hdr: null, interlaced: true })
    expect(result.audio).toEqual({ index: 3, codec: 'lpcm', channels: 2, sampleRate: 48_000 })
    expect(result).toMatchObject({ formatName: 'matroska,webm', duration: null, bitrate: null, audioIndexes: [2, 3], dataStreams: [] })
    expect(result.audioStreams.map(stream => stream.codec)).toEqual(['mp2', 'lpcm'])
    // Ordre des trames : entrelacé seulement s'il est annoncé (tt, bb, tb, bt).
    const order = (field_order: unknown) => parseFfprobe(ffprobe([stream({ index: 0, codec_type: 'video', codec_name: 'h264', width: 64, height: 64, field_order })])).video?.interlaced
    expect([order('bb'), order('tb'), order('bt'), order('progressive'), order('unknown'), order(undefined), order(1)]).toEqual([true, true, true, false, false, false, false])
  })

  it('WebM d\'un navigateur : cadence inconnue (1000 annoncé), durée du flux en repli', () => {
    const result = parseFfprobe(ffprobe([
      stream({ index: 0, codec_type: 'video', codec_name: 'vp8', width: 160, height: 90, pix_fmt: 'yuv420p', avg_frame_rate: '0/0', r_frame_rate: '1000/1', duration: '1.961000' }),
      stream({ index: 1, codec_type: 'audio', codec_name: 'opus', channels: 1, sample_rate: '48000' }),
    ], { format_name: 'matroska,webm' }))
    expect(result.video).toMatchObject({ codec: 'vp8', fps: null, bitDepth: 8, hdr: null })
    expect(result.duration).toBe(1.961)
    expect(result.audio?.codec).toBe('opus')
  })

  it('PQ (HDR10), cadence fractionnaire, étiquettes vidéo gardées quand le lecteur de D1 les connaît', () => {
    const result = parseFfprobe(ffprobe([stream({ index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'hev1', width: 3840, height: 2160, pix_fmt: 'yuv420p10le', color_transfer: 'smpte2084', avg_frame_rate: '30000/1001' })]))
    expect(result.video).toMatchObject({ codec: 'hev1', hdr: 'pq', fps: 29.97, bitDepth: 10 })
    expect(result.audio).toBeNull()
  })

  it('codecs ramenés aux codes du lecteur de D1', () => {
    expect(normalizeVideoCodec('h264', 'avc1')).toBe('avc1')
    expect(normalizeVideoCodec('h264', 'avc3')).toBe('avc3')
    expect(normalizeVideoCodec('h264', 'H264')).toBe('avc1')
    expect(normalizeVideoCodec('h264', '[0][0][0][0]')).toBe('avc1')
    expect(normalizeVideoCodec('hevc', 'hev1')).toBe('hev1')
    expect(normalizeVideoCodec('hevc', null)).toBe('hvc1')
    expect(normalizeVideoCodec('av1', 'av01')).toBe('av01')
    expect(normalizeVideoCodec('vp9', 'vp09')).toBe('vp09')
    expect(normalizeVideoCodec('vp9', null)).toBe('vp9')
    expect(normalizeVideoCodec('mpeg4', 'XVID')).toBe('mp4v')
    expect(normalizeVideoCodec('prores', 'apch')).toBe('apch')
    expect(normalizeVideoCodec('prores', 'icod')).toBe('apcn')
    expect(normalizeVideoCodec('wmv3', 'WMV3')).toBe('wmv3')
    expect(normalizeVideoCodec('theora', null)).toBe('theora')
    expect(normalizeVideoCodec(null, '<script>')).toBe('unknown')
    expect(normalizeAudioCodec('aac')).toBe('mp4a')
    expect(normalizeAudioCodec('eac3')).toBe('ec-3')
    expect(normalizeAudioCodec('pcm_s24le')).toBe('lpcm')
    expect(normalizeAudioCodec('wmav2')).toBe('wmav2')
    expect(normalizeAudioCodec(null)).toBe('unknown')
  })

  it('sons au codec non identifié (audio spatial « apac ») : ni retenus ni copiés', () => {
    const result = parseFfprobe(ffprobe([
      stream({ index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'hvc1', width: 1920, height: 1080 }),
      stream({ index: 1, codec_type: 'audio', codec_tag_string: 'apac' }),
      { index: 2, codec_type: 'audio', codec_name: 'aac', codec_tag_string: 'mp4a', channels: 2, disposition: { default: 0 } },
      stream({ index: 3, codec_type: 'audio', codec_name: 'none', codec_tag_string: 'apac' }),
    ]))
    expect(result.audio).toMatchObject({ index: 2, codec: 'mp4a' })
    expect(result.audioIndexes).toEqual([2])
    expect(result.audioStreams).toEqual([result.audio])
    expect(parseFfprobe(ffprobe([stream({ index: 0, codec_type: 'video', codec_name: 'h264', width: 64, height: 64 }), stream({ index: 1, codec_type: 'audio' })]))).toMatchObject({ audio: null, audioStreams: [], audioIndexes: [] })
  })

  it('pistes de données : fourcc lisible sinon codec, sans doublon, bornées', () => {
    const streams = [
      stream({ index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }),
      stream({ index: 1, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'gpmd' }),
      stream({ index: 2, codec_type: 'data', codec_name: 'klv', codec_tag_string: '[0][0][0][0]' }),
      stream({ index: 3, codec_type: 'data', codec_tag_string: '[0][0][0][0]' }),
      ...Array.from({ length: 40 }, (_, i) => stream({ index: 4 + i, codec_type: 'data', codec_tag_string: `d${i}` })),
    ]
    const result = parseFfprobe(ffprobe(streams))
    expect(result.dataStreams.slice(0, 3)).toEqual(['gpmd', 'klv', 'data'])
    expect(result.dataStreams).toHaveLength(16)
  })

  it('sans flux vidéo : video null (le plan échoue en NO_VIDEO_TRACK) ; dimensions absentes : idem', () => {
    expect(parseFfprobe(ffprobe([stream({ index: 0, codec_type: 'audio', codec_name: 'mp3' })])).video).toBeNull()
    expect(parseFfprobe(ffprobe([stream({ index: 0, codec_type: 'video', codec_name: 'h264', width: 0, height: 1080 })])).video).toBeNull()
    expect(parseFfprobe(ffprobe([{ index: 0, codec_type: 'video', codec_name: 'png', width: 64, height: 64, disposition: { attached_pic: 1 } }])).video).toBeNull()
  })

  it('sortie invalide ou sans flux : VideoToolError UNREADABLE', () => {
    for (const output of ['', 'not json', 'null', '[]', '{}', '{"streams": []}', '{"streams": "x"}']) {
      expect(() => parseFfprobe(output)).toThrow(VideoToolError)
      try {
        parseFfprobe(output)
      }
      catch (error) {
        expect((error as VideoToolError).code).toBe('UNREADABLE')
      }
    }
  })
})

// ─── Plan d'une tâche ────────────────────────────────────────────────────────

const H264_1080: ProbeResult = {
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  duration: 60,
  bitrate: 8_000_000,
  video: { index: 0, codec: 'avc1', width: 1920, height: 1080, rotation: 0, fps: 30, pixFmt: 'yuv420p', bitDepth: 8, hdr: null, interlaced: false },
  audio: { index: 1, codec: 'mp4a', channels: 2, sampleRate: 48_000 },
  audioStreams: [{ index: 1, codec: 'mp4a', channels: 2, sampleRate: 48_000 }],
  audioIndexes: [1],
  dataStreams: [],
}

const metadataOf = (fields: Partial<VideoMetadata>): VideoMetadata => videoMetadata({
  container: 'mp4', videoCodec: 'avc1', audioCodec: 'mp4a', codecs: 'avc1.640028,mp4a.40.2', hasAudio: true, rotation: 0, bitrate: 8_000_000,
  faststart: true, hasLocation: false, playback: 'broad', prepared: ['faststart'], durationEstimated: false, dataTracks: [], hdr: null, rewrites: [],
  ...fields,
})!

/** HEVC (compatibilité variable) selon le lecteur de D1. */
const HEVC = { metadata: metadataOf({ videoCodec: 'hvc1', codecs: null, playback: 'variable' }) }

/** Sons d'une analyse, réduits à leurs codecs (le reste ne compte pas pour le plan). */
const sounds = (...codecs: string[]): Pick<ProbeResult, 'audio' | 'audioStreams' | 'audioIndexes'> => {
  const audioStreams = codecs.map((codec, i) => ({ index: i + 1, codec, channels: 2, sampleRate: 48_000 }))
  return { audio: audioStreams[0] ?? null, audioStreams, audioIndexes: audioStreams.map(stream => stream.index) }
}

function plan(overrides: Partial<PlanInput> = {}, probe: Partial<ProbeResult> = {}, video: Partial<NonNullable<ProbeResult['video']>> = {}) {
  return planVideoJob({
    container: 'mp4',
    metadata: metadataOf({}),
    duration: null,
    probe: { ...H264_1080, ...probe, video: probe.video === null ? null : { ...H264_1080.video!, ...video } },
    hasPoster: true,
    settings: { rendition: 'auto', av1: false, maxDuration: 10_800 },
    capabilities: { hdrFilters: true, av1: true },
    existing: [],
    ...overrides,
  })
}

describe('planVideoJob', () => {
  it('H.264 1080p raisonnable, avec affiche : rien à faire', () => {
    expect(plan()).toEqual({ failure: null, steps: [], toneMap: false, target: null, warnings: [], duration: 60 })
  })

  it('sans affiche : affiche seulement', () => {
    expect(plan({ hasPoster: false }).steps).toEqual(['poster'])
  })

  it('mode auto : rendu pour une compatibilité variable, un format converti, > 1080 px, > 10 Mbit/s, HDR ou entrelacé', () => {
    expect(plan(HEVC, {}, { codec: 'hvc1' })).toMatchObject({ steps: ['transcode'], target: { width: 1920, height: 1080 } })
    expect(plan({ container: 'mkv', metadata: null }).steps).toEqual(['transcode'])
    expect(plan({ container: 'avi', metadata: metadataOf({ container: 'avi', playback: 'none' }) }).steps).toEqual(['transcode'])
    expect(plan({}, {}, { width: 3840, height: 2160 })).toMatchObject({ steps: ['transcode'], target: { width: 1920, height: 1080 } })
    expect(plan({}, {}, { width: 1080, height: 1920 }).steps).toEqual([])
    expect(plan({}, { bitrate: 12_000_000 }).steps).toEqual(['transcode'])
    expect(plan({}, { bitrate: null }).steps).toEqual([])
    expect(plan({ metadata: metadataOf({ bitrate: 15_000_000 }) }, { bitrate: null }).steps).toEqual(['transcode'])
    expect(plan({}, {}, { hdr: 'hlg' })).toMatchObject({ steps: ['transcode'], toneMap: true, warnings: ['hdr_converted'] })
    // H.264 1080i d'un caméscope dans un MP4 : lisible, mais les navigateurs n'en désentrelacent pas les images.
    expect(plan({}, {}, { interlaced: true }).steps).toEqual(['transcode'])
  })

  it('compatibilité calculée d\'après l\'analyse quand les métadonnées manquent', () => {
    expect(plan({ metadata: null }).steps).toEqual([])
    expect(plan({ metadata: null }, {}, { codec: 'hvc1' }).steps).toEqual(['transcode'])
    expect(plan({ metadata: null }, sounds('ac-3')).steps).toEqual(['transcode'])
    expect(plan({ container: 'webm', metadata: null }, sounds('opus'), { codec: 'vp9' }).steps).toEqual([])
  })

  it('modes always et never', () => {
    expect(plan({ settings: { rendition: 'always', av1: false, maxDuration: 10_800 } }).steps).toEqual(['transcode'])
    expect(plan({ hasPoster: false, settings: { rendition: 'never', av1: false, maxDuration: 10_800 } }, {}, { codec: 'hvc1', width: 3840, height: 2160 })).toEqual({
      failure: null, steps: ['poster'], toneMap: false, target: null, warnings: [], duration: 60,
    })
  })

  it('mode never : un format converti reçoit quand même son rendu (sans lui, jamais lisible), AV1 compris s\'il est activé', () => {
    const never = { rendition: 'never' as const, av1: false, maxDuration: 10_800 }
    expect(plan({ container: 'mkv', metadata: null, settings: never })).toMatchObject({ failure: null, steps: ['transcode'], target: { width: 1920, height: 1080 } })
    expect(plan({ container: 'avi', metadata: null, settings: { ...never, av1: true } }).steps).toEqual(['transcode', 'av1'])
    expect(plan({ container: 'mkv', metadata: null, settings: never }, { duration: 20_000 })).toMatchObject({ failure: 'TOO_LONG', steps: [] })
  })

  it('AV1 : demandé, possible et rendu utile', () => {
    const settings = { rendition: 'auto' as const, av1: true, maxDuration: 10_800 }
    expect(plan({ ...HEVC, settings }, {}, { codec: 'hvc1' }).steps).toEqual(['transcode', 'av1'])
    expect(plan({ settings }).steps).toEqual([])
    expect(plan({ ...HEVC, settings, capabilities: { hdrFilters: true, av1: false } }, {}, { codec: 'hvc1' }).steps).toEqual(['transcode'])
  })

  it('rendus déjà produits (reprise) : non refaits ; tout fait : plus de dimensions cibles', () => {
    const settings = { rendition: 'always' as const, av1: true, maxDuration: 10_800 }
    expect(plan({ settings, existing: ['h264'] })).toMatchObject({ steps: ['av1'], target: { width: 1920, height: 1080 } })
    expect(plan({ settings, existing: ['h264', 'av1'], hasPoster: false })).toMatchObject({ steps: ['poster'], target: null })
  })

  it('pistes de données : retrait pour MP4 et MOV seulement, d\'après ffprobe ou le lecteur de D1', () => {
    expect(plan({}, { dataStreams: ['gpmd'] }).steps).toEqual(['sanitize'])
    expect(plan({ metadata: metadataOf({ dataTracks: ['mebx'] }) }).steps).toEqual(['sanitize'])
    expect(plan({ container: 'mov', metadata: metadataOf({ container: 'mov' }) }, { dataStreams: ['camm'] }).steps).toEqual(['sanitize'])
    expect(plan({ container: 'mkv', metadata: null }, { dataStreams: ['klv'] }).steps).toEqual(['transcode'])
  })

  const webm = metadataOf({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', playback: 'broad', faststart: null, prepared: null })

  it('WebM sans durée : réparation (durée estimée par D1 ou inconnue pour ffprobe)', () => {
    expect(plan({ container: 'webm', metadata: { ...webm, durationEstimated: true } }, sounds('opus'), { codec: 'vp9' }).steps).toEqual(['repair'])
    expect(plan({ container: 'webm', metadata: webm }, { duration: null, ...sounds('opus') }, { codec: 'vp9' }).steps).toEqual(['repair'])
    expect(plan({ container: 'webm', metadata: webm }, sounds('opus'), { codec: 'vp9' }).steps).toEqual([])
    expect(plan({ container: 'webm', metadata: null }, { duration: null, ...sounds() }, { codec: 'vp8' }).steps).toEqual(['repair'])
    expect(plan({ container: 'webm', metadata: null }, { duration: null, ...sounds('vorbis') }, { codec: 'av01' }).steps).toEqual(['repair', 'transcode'])
    expect(plan({ container: 'mp4' }, { duration: null }).steps).toEqual([])
  })

  it('WebM sans durée aux codecs que le format WebM ne porte pas (H.264 ou PCM de Chrome) : pas de réparation, le rendu suffit', () => {
    const chrome = { ...webm, videoCodec: 'avc1', playback: 'variable' as const, durationEstimated: true }
    expect(plan({ container: 'webm', metadata: chrome, duration: 12.5 }, { duration: null, ...sounds('opus') }, { codec: 'avc1', fps: null })).toMatchObject({
      failure: null, steps: ['transcode'], duration: 12.5,
    })
    expect(plan({ container: 'webm', metadata: { ...webm, audioCodec: 'lpcm', playback: 'variable', durationEstimated: true } }, { duration: null, ...sounds('lpcm') }, { codec: 'vp8' }).steps).toEqual(['transcode'])
    // Un seul son impossible à copier suffit : la copie échouerait.
    expect(plan({ container: 'webm', metadata: { ...webm, durationEstimated: true } }, sounds('opus', 'mp4a'), { codec: 'vp9' }).steps).toEqual([])
  })

  it('toutes les étapes, dans l\'ordre d\'exécution', () => {
    expect(plan({
      metadata: metadataOf({ playback: 'variable', dataTracks: ['gpmd'] }),
      hasPoster: false,
      settings: { rendition: 'auto', av1: true, maxDuration: 10_800 },
    }, {}, { codec: 'hvc1' }).steps).toEqual(['sanitize', 'transcode', 'av1', 'poster'])
  })

  it('HDR sans filtres de conversion : rendu sans correction, avertissement ; sans rendu, aucun avertissement', () => {
    const capabilities = { hdrFilters: false, av1: false }
    expect(plan({ capabilities }, {}, { hdr: 'pq' })).toMatchObject({ steps: ['transcode'], toneMap: false, warnings: ['hdr_unconverted'] })
    expect(plan({ settings: { rendition: 'never', av1: false, maxDuration: 10_800 }, hasPoster: false }, {}, { hdr: 'pq' })).toMatchObject({ steps: ['poster'], toneMap: true, warnings: [] })
  })

  it('échecs immédiats : pas de vidéo, dimensions absurdes', () => {
    expect(plan({}, { video: null })).toEqual({ failure: 'NO_VIDEO_TRACK', steps: [], toneMap: false, target: null, warnings: [], duration: 60 })
    expect(plan({}, {}, { width: 20_000 }).failure).toBe('UNREADABLE')
  })

  it('trop long (rendu utile au-delà de la durée maximale) : pas de réencodage, mais retrait des pistes de données et affiche, puis échec TOO_LONG', () => {
    const long = { duration: 4 * 3600 }
    expect(plan({ ...HEVC, hasPoster: false }, long, { codec: 'hvc1', hdr: 'hlg' })).toEqual({
      failure: 'TOO_LONG', steps: ['poster'], toneMap: true, target: null, warnings: [], duration: 4 * 3600,
    })
    expect(plan({ ...HEVC }, long, { codec: 'hvc1' })).toMatchObject({ failure: 'TOO_LONG', steps: [] })
    // Positions GPS d'une vidéo 4K de 12 min (limite à 10 min) : retirées malgré l'échec du rendu.
    const settings = { rendition: 'auto' as const, av1: true, maxDuration: 600 }
    expect(plan({ settings }, { duration: 720, dataStreams: ['gpmd'] }, { codec: 'hvc1', width: 3840, height: 2160 })).toMatchObject({
      failure: 'TOO_LONG', steps: ['sanitize'], target: null,
    })
    // Rendu inutile : la durée ne compte pas.
    expect(plan({ hasPoster: false }, { ...long, dataStreams: ['gpmd'] })).toMatchObject({ failure: null, steps: ['sanitize', 'poster'] })
    // Rendus déjà faits (reprise) : rien à réencoder, pas d'échec.
    expect(plan({ ...HEVC, existing: ['h264'] }, long, { codec: 'hvc1' })).toMatchObject({ failure: null, steps: [] })
    expect(plan({ ...HEVC, settings: { rendition: 'auto', av1: false, maxDuration: 60 } }, { duration: 60 }, { codec: 'hvc1' }).failure).toBeNull()
  })

  it('durée inconnue pour ffprobe : celle du média en repli (estimation de D1 d\'un WebM), sinon aucune limite', () => {
    const recording = { container: 'webm' as const, metadata: { ...webm, durationEstimated: true, videoCodec: 'av01', playback: 'variable' as const } }
    const probe = { duration: null, ...sounds('opus') }
    // Enregistrement de 5 h sans durée dans le fichier : réparé, mais pas réencodé.
    expect(plan({ ...recording, duration: 5 * 3600 }, probe, { codec: 'av01', fps: null, width: 2560, height: 1440 })).toMatchObject({
      failure: 'TOO_LONG', steps: ['repair'], duration: 5 * 3600,
    })
    expect(plan({ ...recording, duration: 600 }, probe, { codec: 'av01', fps: null })).toMatchObject({ failure: null, steps: ['repair', 'transcode'], duration: 600 })
    // La durée de ffprobe prime sur celle enregistrée.
    expect(plan({ ...HEVC, duration: 5 * 3600 }, { duration: 30 }, { codec: 'hvc1' })).toMatchObject({ failure: null, steps: ['transcode'], duration: 30 })
    // Aucune durée nulle part : pas de limite ici, l'encodage est borné par sa sortie (run.ts, maxOutputSeconds).
    expect(plan({ container: 'mkv', metadata: null, duration: null }, { duration: null })).toMatchObject({ failure: null, steps: ['transcode'], duration: null })
    expect(plan({ container: 'mkv', metadata: null, duration: 0 }, { duration: null }).duration).toBeNull()
  })
})

describe('dimensions et affiche', () => {
  it('scaledDimensions : petit côté ≤ 1080, jamais agrandi, dimensions paires', () => {
    expect(scaledDimensions(3840, 2160)).toEqual({ width: 1920, height: 1080 })
    expect(scaledDimensions(2160, 3840)).toEqual({ width: 1080, height: 1920 })
    expect(scaledDimensions(4096, 2160)).toEqual({ width: 2048, height: 1080 })
    expect(scaledDimensions(1920, 1081)).toEqual({ width: 1918, height: 1080 })
    expect(scaledDimensions(1280, 720)).toEqual({ width: 1280, height: 720 })
    expect(scaledDimensions(1279, 719)).toEqual({ width: 1278, height: 718 })
    expect(scaledDimensions(1, 1)).toEqual({ width: 2, height: 2 })
    expect(scaledDimensions(640, 480, 240)).toEqual({ width: 320, height: 240 })
  })

  it('posterTimes : 10 % de la durée (5 s au plus), puis 1 s et 2 s plus loin, jamais après 90 %', () => {
    expect(posterTimes(120)).toEqual([5, 6, 7])
    expect(posterTimes(20)).toEqual([2, 3, 4])
    expect(posterTimes(2)).toEqual([0.2, 1.2, 1.8])
    expect(posterTimes(0.5)).toEqual([0.05, 0.45])
    expect(posterTimes(null)).toEqual([0.5, 1.5, 2.5])
    expect(posterTimes(0)).toEqual([0.5, 1.5, 2.5])
  })

  it('frameLuminance : moyenne pondérée BT.709 des canaux, ou canal gris', () => {
    expect(frameLuminance([0, 0, 0])).toBe(0)
    expect(frameLuminance([255, 255, 255])).toBeCloseTo(255, 6)
    expect(frameLuminance([255, 0, 0])).toBeCloseTo(54.2, 1)
    expect(frameLuminance([12])).toBe(12)
    expect(frameLuminance([])).toBe(0)
  })
})
