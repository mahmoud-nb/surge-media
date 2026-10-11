/**
 * Pistes de texte des vidéos (phase D2, architecture § 20) : fichiers WebVTT ou SubRip (SRT, converti)
 * **analysés puis réécrits** en WebVTT normalisé — UTF-8, fins de ligne LF, horodatages complets
 * (hh:mm:ss.mmm), commentaires NOTE retirés, blocs STYLE et REGION conservés, réglages de réplique
 * valides conservés. Un fichier refusé l'est avec le numéro de la ligne en cause. Fonctions pures, testées.
 *
 * Le texte des répliques n'est jamais interprété comme du HTML : l'analyseur WebVTT des navigateurs ne
 * connaît que ses balises (c, i, b, u, v, lang, ruby, rt, horodatages) ; une balise SRT inconnue est
 * retirée, un « < » isolé échappé.
 */

/** Taille maximale d'un fichier de piste (1 Mio : plusieurs heures de sous-titres). */
export const TEXT_TRACK_MAX_SIZE = 1024 * 1024
export const TEXT_TRACK_MAX_CUES = 20_000
/** Caractères au plus dans le texte d'une réplique. */
export const CUE_TEXT_MAX_LENGTH = 2000
const CUE_ID_MAX_LENGTH = 256
/** Fin de réplique la plus tardive acceptée (horodatage sur 2 chiffres d'heures étendu : 1000 h). */
const MAX_TIMESTAMP_MS = 1000 * 3600 * 1000

export type TextTrackFormat = 'vtt' | 'srt'

export interface ParsedTextTrack {
  /** Fichier WebVTT normalisé. */
  vtt: string
  cueCount: number
  sourceFormat: TextTrackFormat
}

/** Fichier refusé ; `line` : ligne en cause (1 = première), null si elle n'a pas de sens. */
export class TextTrackError extends Error {
  constructor(readonly line: number | null, message: string) {
    super(message)
    this.name = 'TextTrackError'
  }
}

// ─── Décodage ────────────────────────────────────────────────────────────────

/**
 * Texte d'un fichier : UTF-8 (avec ou sans BOM), UTF-16 avec BOM, sinon Windows-1252 (anciens SRT
 * français). Fins de ligne normalisées (LF).
 */
export function decodeTextTrack(bytes: Uint8Array): string {
  let text: string
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) text = new TextDecoder('utf-16le').decode(bytes.subarray(2))
  else if (bytes[0] === 0xFE && bytes[1] === 0xFF) text = new TextDecoder('utf-16be').decode(bytes.subarray(2))
  else {
    const body = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ? bytes.subarray(3) : bytes
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    }
    catch {
      text = new TextDecoder('windows-1252').decode(body)
    }
  }
  if (text.includes('\0')) throw new TextTrackError(null, 'The file contains binary data: it is not a text file.')
  return text.replace(/\r\n?/g, '\n')
}

// ─── Horodatages ─────────────────────────────────────────────────────────────

const TIMESTAMP = /^(?:(\d{1,4}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/

/** Horodatage (h:mm:ss.mmm, minutes et secondes < 60) → millisecondes ; null s'il est invalide. */
function parseTimestamp(value: string): number | null {
  const match = TIMESTAMP.exec(value.trim())
  if (!match) return null
  const [, hours = '0', minutes, seconds, fraction] = match
  if (Number(minutes) > 59 || Number(seconds) > 59) return null
  const milliseconds = Number(fraction!.padEnd(3, '0'))
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + milliseconds
}

function formatTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor(ms / 60_000) % 60
  const seconds = Math.floor(ms / 1000) % 60
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms % 1000, 3)}`
}

// ─── Réglages de réplique (WebVTT) ───────────────────────────────────────────

const PERCENT = /^\d{1,3}(?:\.\d+)?%$/
const SETTINGS: Record<string, (value: string) => boolean> = {
  vertical: value => value === 'rl' || value === 'lr',
  line: value => /^(?:-?\d+(?:\.\d+)?%?)(?:,(?:start|center|end))?$/.test(value),
  position: value => /^\d{1,3}(?:\.\d+)?%(?:,(?:line-left|center|line-right))?$/.test(value),
  size: value => PERCENT.test(value),
  align: value => ['start', 'center', 'end', 'left', 'right'].includes(value),
  region: value => /^[^\s:-]{1,64}$/.test(value),
}

/** Réglages valides d'une ligne de temps (les autres sont ignorés, comme par les navigateurs). */
function cueSettings(raw: string): string {
  return raw.split(/[ \t]+/).filter((token) => {
    const at = token.indexOf(':')
    if (at <= 0) return false
    const check = SETTINGS[token.slice(0, at)]
    return Boolean(check?.(token.slice(at + 1)))
  }).join(' ')
}

// ─── Répliques ───────────────────────────────────────────────────────────────

interface Cue {
  id: string | null
  start: number
  end: number
  settings: string
  text: string
}

interface Line {
  text: string
  /** Numéro de ligne dans le fichier (1 = première). */
  number: number
}

/** Blocs séparés par une ou plusieurs lignes vides. */
function blocks(text: string, firstLine = 1): Line[][] {
  const result: Line[][] = []
  let current: Line[] = []
  text.split('\n').forEach((value, index) => {
    if (value.trim() === '') {
      if (current.length) result.push(current)
      current = []
    }
    else current.push({ text: value, number: firstLine + index })
  })
  if (current.length) result.push(current)
  return result
}

/** Ligne de temps « début --> fin [réglages] » ; null si la ligne n'en est pas une. */
function timing(line: Line, srt: boolean): { start: number, end: number, settings: string } | null {
  const arrow = line.text.indexOf('-->')
  if (arrow < 0) return null
  const startText = line.text.slice(0, arrow).trim()
  const rest = line.text.slice(arrow + 3).trim()
  const [endText = '', ...settings] = rest.split(/[ \t]+/)
  const start = parseTimestamp(startText)
  const end = parseTimestamp(endText)
  if (start === null || end === null) throw new TextTrackError(line.number, `Invalid cue timing "${line.text.trim().slice(0, 60)}".`)
  if (end <= start) throw new TextTrackError(line.number, 'The cue ends before it starts.')
  if (end > MAX_TIMESTAMP_MS) throw new TextTrackError(line.number, 'Cue timing out of range.')
  // SubRip : coordonnées facultatives (X1:… Y2:…) ignorées.
  return { start, end, settings: srt ? '' : cueSettings(settings.join(' ')) }
}

function checkCue(cue: Cue, line: number, count: number): void {
  if (cue.text.length > CUE_TEXT_MAX_LENGTH) throw new TextTrackError(line, `Cue text longer than ${CUE_TEXT_MAX_LENGTH} characters.`)
  if (count > TEXT_TRACK_MAX_CUES) throw new TextTrackError(line, `More than ${TEXT_TRACK_MAX_CUES} cues.`)
}

/** Texte SubRip → texte WebVTT : i, b, u gardés ; font et balises ASS ({\an8}) retirées ; « < », « > », « & » échappés. */
function srtText(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .split(/(<\/?[a-z][^<>]*>)/i)
    .map((part, index) => {
      if (index % 2 === 1) {
        const tag = /^<(\/?)([biu])\s*>$/i.exec(part)
        return tag ? `<${tag[1]}${tag[2]!.toLowerCase()}>` : ''
      }
      return part.replace(/&(?!(?:amp|lt|gt|nbsp|lrm|rlm);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    })
    .join('')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line !== '')
    .join('\n')
}

function parseSrt(text: string): Cue[] {
  const cues: Cue[] = []
  for (const block of blocks(text)) {
    let index = 0
    // Numéro de réplique facultatif, puis la ligne de temps.
    if (block.length > 1 && /^\d+$/.test(block[0]!.text.trim()) && block[1]!.text.includes('-->')) index = 1
    const times = timing(block[index]!, true)
    if (!times) throw new TextTrackError(block[index]!.number, 'Expected a cue timing ("00:00:01,000 --> 00:00:04,000").')
    const cue: Cue = { id: null, ...times, text: srtText(block.slice(index + 1).map(line => line.text).join('\n')) }
    checkCue(cue, block[0]!.number, cues.length + 1)
    cues.push(cue)
  }
  return cues
}

/** Texte d'une réplique WebVTT : lignes conservées (balises WebVTT comprises), « --> » interdit. */
function vttText(lines: Line[]): string {
  for (const line of lines) {
    if (line.text.includes('-->')) throw new TextTrackError(line.number, 'Cue text cannot contain "-->" (missing blank line between cues?).')
  }
  return lines.map(line => line.text.trimEnd()).join('\n')
}

function parseVtt(text: string): { cues: Cue[], headerBlocks: string[] } {
  const all = blocks(text)
  const header = all.shift()!
  // Signature « WEBVTT », éventuellement suivie d'un texte ; les autres lignes d'en-tête sont ignorées.
  if (!/^WEBVTT(?:[ \t].*)?$/.test(header[0]!.text.trim())) throw new TextTrackError(header[0]!.number, 'The file must start with "WEBVTT".')
  // Première réplique collée à l'en-tête (ligne vide oubliée) : reprise comme un bloc.
  const glued = header.findIndex(line => line.text.includes('-->'))
  if (glued > 0) all.unshift(header.slice(glued > 1 ? glued - 1 : glued))
  const cues: Cue[] = []
  const headerBlocks: string[] = []
  for (const block of all) {
    const first = block[0]!.text
    if (/^NOTE(?:[ \t]|$)/.test(first)) continue
    if (/^(?:STYLE|REGION)[ \t]*$/.test(first) && !block.some(line => line.text.includes('-->'))) {
      // Blocs de style et de région : seulement avant la première réplique (sinon ignorés, comme par les navigateurs).
      if (cues.length === 0) headerBlocks.push(block.map(line => line.text.trimEnd()).join('\n'))
      continue
    }
    let index = 0
    let id: string | null = null
    if (!first.includes('-->')) {
      if (block.length < 2 || !block[1]!.text.includes('-->')) throw new TextTrackError(block[0]!.number, 'Expected a cue timing ("00:00:01.000 --> 00:00:04.000").')
      id = first.trim().slice(0, CUE_ID_MAX_LENGTH)
      index = 1
    }
    const times = timing(block[index]!, false)!
    const cue: Cue = { id, ...times, text: vttText(block.slice(index + 1)) }
    checkCue(cue, block[0]!.number, cues.length + 1)
    cues.push(cue)
  }
  return { cues, headerBlocks }
}

function serialize(cues: Cue[], headerBlocks: string[]): string {
  const parts = ['WEBVTT', ...headerBlocks]
  for (const cue of cues) {
    const timingLine = `${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}${cue.settings ? ` ${cue.settings}` : ''}`
    parts.push([cue.id, timingLine, cue.text].filter(line => line !== null && line !== '').join('\n'))
  }
  return `${parts.join('\n\n')}\n`
}

/**
 * Analyse un fichier WebVTT ou SubRip et le réécrit en WebVTT normalisé. Lève `TextTrackError` (avec la
 * ligne en cause) pour un fichier illisible, sans réplique ou hors limites.
 */
export function parseTextTrack(bytes: Uint8Array): ParsedTextTrack {
  if (bytes.length > TEXT_TRACK_MAX_SIZE) throw new TextTrackError(null, `The file exceeds ${TEXT_TRACK_MAX_SIZE} bytes.`)
  const text = decodeTextTrack(bytes)
  const firstLine = text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
  const sourceFormat: TextTrackFormat = /^WEBVTT(?:[ \t]|$)/.test(firstLine) ? 'vtt' : 'srt'
  if (sourceFormat === 'srt' && !text.includes('-->')) {
    throw new TextTrackError(1, 'Not a subtitle file: expected "WEBVTT" (WebVTT) or numbered cues with timings (SubRip).')
  }
  const { cues, headerBlocks } = sourceFormat === 'vtt' ? parseVtt(text) : { cues: parseSrt(text), headerBlocks: [] }
  if (cues.length === 0) throw new TextTrackError(null, 'The file contains no cue.')
  return { vtt: serialize(cues, headerBlocks), cueCount: cues.length, sourceFormat }
}
