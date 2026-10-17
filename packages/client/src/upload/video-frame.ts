/**
 * Image d'affiche capturée dans le navigateur pendant l'envoi d'une vidéo (port de
 * apps/core/app/utils/video-frame.ts) : rien n'est envoyé pour la faire, le serveur normalise ensuite
 * l'image (JPEG, 3840 px au plus). Hors navigateur, ou si le navigateur ne sait pas décoder la vidéo
 * (codec), aucune image : la vidéo garde l'affiche que le serveur extrait quand son traitement est actif.
 */

/** Côté maximal de l'image capturée (celui de l'affiche normalisée). */
const FRAME_MAX_DIMENSION = 3840
const FRAME_QUALITY = 0.92
/** Image presque noire (fondu d'ouverture) : luminance moyenne sous ce seuil (0 à 255). */
const DARK_LUMINANCE = 16
const CAPTURE_TIMEOUT_MS = 15_000

export interface CapturedFrame {
  /** Image JPEG. */
  blob: Blob
  /** Instant capturé, en secondes. */
  time: number
}

function waitFor(video: HTMLVideoElement, event: 'loadeddata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = () => {
      video.removeEventListener(event, done)
      reject(new Error('media error'))
    }
    const done = () => {
      video.removeEventListener('error', failed)
      resolve()
    }
    video.addEventListener(event, done, { once: true })
    video.addEventListener('error', failed, { once: true })
  })
}

/** Dessine l'image courante d'un lecteur (dimensions affichées, rotation comprise). */
function drawFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null
  const scale = Math.min(1, FRAME_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Luminance moyenne d'une image (sur une réduction de 32 × 32 px). */
function luminance(canvas: HTMLCanvasElement): number {
  const small = document.createElement('canvas')
  small.width = 32
  small.height = 32
  const context = small.getContext('2d', { willReadFrequently: true })
  if (!context) return 255
  context.drawImage(canvas, 0, 0, 32, 32)
  const data = context.getImageData(0, 0, 32, 32).data
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
  return sum / (data.length / 4)
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', FRAME_QUALITY))
}

/** Capture possible dans cet environnement (navigateur avec `<video>`, `<canvas>` et URL d'objet). */
export function canCaptureVideoFrame(): boolean {
  return typeof document !== 'undefined' && typeof HTMLMediaElement !== 'undefined' && typeof URL.createObjectURL === 'function'
}

/**
 * Première image significative d'une vidéo locale : à 10 % de la durée (5 s au plus), puis un peu plus
 * loin si l'image est presque noire. null hors navigateur, si le navigateur ne sait pas décoder la vidéo
 * ou si la capture dépasse 15 s.
 */
export async function captureVideoFrame(file: Blob): Promise<CapturedFrame | null> {
  if (!canCaptureVideoFrame()) return null
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)
  })
  const capture = (async () => {
    const loaded = waitFor(video, 'loadeddata')
    video.src = url
    await loaded
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
    const first = duration === null ? 0.5 : Math.min(duration * 0.1, 5)
    let fallback: CapturedFrame | null = null
    for (const offset of [0, 1, 2]) {
      const time = duration === null ? first + offset : Math.min(first + offset, duration * 0.9)
      const seeked = waitFor(video, 'seeked')
      video.currentTime = time
      await seeked
      const canvas = drawFrame(video)
      if (!canvas) return null
      const blob = await toJpeg(canvas)
      if (!blob) return null
      fallback ??= { blob, time: video.currentTime }
      if (luminance(canvas) >= DARK_LUMINANCE) return { blob, time: video.currentTime }
    }
    return fallback
  })().catch(() => null)
  try {
    return await Promise.race([capture, timeout])
  }
  finally {
    clearTimeout(timer)
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
