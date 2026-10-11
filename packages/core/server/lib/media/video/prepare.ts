import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { VideoPreparation } from '#shared/utils/video'
import { VIDEO_PREPARATIONS } from '#shared/utils/video'
import { type IsoMovie, probeIsoBmff, XMP_UUID } from './isobmff'
import { probeVideo, type VideoProbe } from './probe'
import { type ByteSource, guardedSource, MAX_READ_LENGTH, VideoProbeError } from './source'

/**
 * Préparation d'un MP4/MOV à l'envoi, sans réencodage (architecture phase D, § 18, DD15) :
 *   - `faststart` : index (`moov`) placé avant les données (`mdat`), lecture sans aller chercher la fin ;
 *   - `metadata` : métadonnées d'origine retirées (lieu de tournage, appareil, logiciel, réglages) par
 *     une **liste de ce qui est conservé** — chaque fabricant a ses propres boîtes.
 *
 * Le fichier de sortie est une suite de **morceaux** : plages du fichier d'origine (données copiées
 * telles quelles) et `moov` réécrit en mémoire. Chaque boîte de premier niveau garde son contenu ; les
 * décalages des blocs d'échantillons (`stco`/`co64`) sont déplacés d'autant que leur boîte `mdat`.
 * Aucun passage de plus sur le fichier : les morceaux remplacent la copie vers le stockage.
 *
 * La sortie est **vérifiée avant toute écriture** (réanalyse de la sortie virtuelle, comparaison
 * d'octets des blocs) ; au moindre écart, ou pour un fichier non géré (fragmenté, chiffré, données
 * externes, index de plus de 64 Mio), le fichier est gardé tel quel. Pure (lecture par `ByteSource`), testée.
 */

export interface PreparationOptions {
  faststart: boolean
  metadata: boolean
}

/** Morceau du fichier de sortie : plage [start, end) du fichier d'origine, ou octets écrits en mémoire. */
export type PreparationPiece = { start: number, end: number } | Buffer

export interface PreparationPlan {
  pieces: PreparationPiece[]
  size: number
  operations: VideoPreparation[]
  /** Chemins des boîtes et clés retirées (journal, tests) : `moov/udta/©xyz`, `moov/meta/keys:com.android.version`… */
  removed: string[]
  /** Positions des blocs d'échantillons avant / après (vérification). */
  chunks: { from: number, to: number }[]
}

export type PreparationOutcome
  = | { status: 'prepared', plan: PreparationPlan, probe: VideoProbe }
  /** Rien à faire : index déjà en tête (ou non demandé), aucune métadonnée à retirer. */
    | { status: 'unchanged' }
  /** Fichier non géré ou vérification en échec : gardé tel quel. */
    | { status: 'skipped', reason: string }

/** Index lu en mémoire au plus (en pratique quelques Mio, même pour 2 Gio de vidéo). */
export const MAX_MOOV_SIZE = 64 * 1024 * 1024
const MAX_TOP_LEVEL_BOXES = 10_000
const MAX_NODES = 100_000
/** Blocs comparés par table de décalages (premier, dernier et intermédiaires). */
const CHECKED_CHUNKS = 8
const CHECKED_BYTES = 32

/** NUXT_MEDIA_VIDEO_PREPARE : `faststart,metadata` (défaut), `none`, ou une partie. Pure, testée. */
export function parseVideoPreparation(raw: unknown, warn: (message: string) => void = () => {}): PreparationOptions {
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(',') : 'faststart,metadata'
  const tokens = value.split(/[\s,]+/).map(token => token.trim().toLowerCase()).filter(Boolean)
  const options = { faststart: false, metadata: false }
  for (const token of tokens) {
    if (token === 'none') continue
    if ((VIDEO_PREPARATIONS as readonly string[]).includes(token)) options[token as VideoPreparation] = true
    else warn(`[surge-media] NUXT_MEDIA_VIDEO_PREPARE : « ${token} » inconnu (valeurs : faststart, metadata, none), ignoré.`)
  }
  return options
}

// ─── Boîtes ──────────────────────────────────────────────────────────────────

class Skip extends Error {}

interface TopBox {
  type: string
  start: number
  end: number
  /** Taille de l'en-tête (8, ou 16 avec `largesize`). */
  header: number
}

async function topLevelBoxes(source: ByteSource): Promise<TopBox[]> {
  const boxes: TopBox[] = []
  for (let offset = 0; offset < source.size;) {
    if (boxes.length >= MAX_TOP_LEVEL_BOXES) throw new Skip('too many top-level boxes')
    const head = await source.read(offset, 16)
    if (head.length < 8) throw new Skip('truncated top-level box')
    const type = head.toString('latin1', 4, 8)
    let size = head.readUInt32BE(0)
    let header = 8
    if (size === 1) {
      if (head.length < 16) throw new Skip('truncated top-level box')
      size = Number(head.readBigUInt64BE(8))
      header = 16
    }
    else if (size === 0) size = source.size - offset
    if (size < header) throw new Skip(`invalid size of ${type}`)
    // `mdat` tronqué en fin de fichier : toléré par l'analyse (D1), copié tel quel.
    const end = Math.min(offset + size, source.size)
    if (offset + size > source.size && type !== 'mdat') throw new Skip(`truncated ${type}`)
    boxes.push({ type, start: offset, end, header })
    offset = end
  }
  return boxes
}

async function readRange(source: ByteSource, start: number, length: number): Promise<Buffer> {
  const parts: Buffer[] = []
  for (let offset = 0; offset < length; offset += MAX_READ_LENGTH) {
    const part = await source.read(start + offset, Math.min(MAX_READ_LENGTH, length - offset))
    if (part.length === 0) break
    parts.push(part)
  }
  const buffer = Buffer.concat(parts)
  if (buffer.length !== length) throw new Skip('truncated read')
  return buffer
}

/** Boîte du `moov` en mémoire : conteneur (enfants) ou contenu opaque. */
interface Node {
  type: string
  /** En-tête d'origine (8 ou 16 octets) ; la taille est réécrite à la sérialisation. */
  header: Buffer
  /** `meta` ISO : version et drapeaux avant les enfants. */
  prefix?: Buffer
  children?: Node[]
  payload?: Buffer
  /** Fin d'un conteneur trop courte pour une boîte (marque de fin QuickTime de `udta`). */
  tail?: Buffer
}

/** Conteneurs parcourus : chemin vers les tables de décalages et les métadonnées. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'udta', 'edts', 'mvex', 'meta', 'ilst'])

function parseNodes(buffer: Buffer, start: number, end: number, counter: { nodes: number }, depth: number): { nodes: Node[], tail?: Buffer } {
  if (depth > 12) throw new Skip('boxes nested too deeply')
  const nodes: Node[] = []
  let offset = start
  while (end - offset >= 8) {
    if (++counter.nodes > MAX_NODES) throw new Skip('too many boxes')
    let size = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    let header = 8
    if (size === 1) {
      if (end - offset < 16) throw new Skip('truncated box')
      size = Number(buffer.readBigUInt64BE(offset + 8))
      header = 16
    }
    else if (size === 0) size = end - offset
    // Une fin de conteneur de moins de 8 octets (marque de fin QuickTime de `udta`) est gardée telle quelle.
    if (size < header || offset + size > end) throw new Skip(`invalid size of ${type}`)
    const node: Node = { type, header: buffer.subarray(offset, offset + header) }
    const bodyStart = offset + header
    const bodyEnd = offset + size
    if (CONTAINERS.has(type)) {
      let childrenStart = bodyStart
      if (type === 'meta') {
        // ISO : boîte complète (version + drapeaux) ; QuickTime : simple conteneur.
        const full = bodyEnd - bodyStart >= 12 && buffer.readUInt32BE(bodyStart) === 0 && buffer.toString('latin1', bodyStart + 8, bodyStart + 12) === 'hdlr'
        if (full) {
          node.prefix = buffer.subarray(bodyStart, bodyStart + 4)
          childrenStart += 4
        }
      }
      // Éléments d'une liste `ilst` : opaques (seul leur type, ou numéro de clé, compte).
      if (type === 'ilst') {
        node.children = parseNodes(buffer, childrenStart, bodyEnd, counter, depth + 1).nodes
        for (const item of node.children) {
          if (item.children) {
            // Un élément dont le type est celui d'un conteneur : remis en contenu opaque.
            item.payload = serialize(item).subarray(item.header.length)
            delete item.children
          }
        }
      }
      else {
        const parsed = parseNodes(buffer, childrenStart, bodyEnd, counter, depth + 1)
        node.children = parsed.nodes
        if (parsed.tail) node.tail = parsed.tail
      }
    }
    else {
      node.payload = buffer.subarray(bodyStart, bodyEnd)
    }
    nodes.push(node)
    offset = bodyEnd
  }
  return { nodes, tail: offset < end ? buffer.subarray(offset, end) : undefined }
}

function nodeSize(node: Node): number {
  const body = node.children
    ? (node.prefix?.length ?? 0) + node.children.reduce((total, child) => total + nodeSize(child), 0) + (node.tail?.length ?? 0)
    : node.payload!.length
  return node.header.length + body
}

function serializeInto(node: Node, parts: Buffer[]): void {
  const header = Buffer.from(node.header)
  const size = nodeSize(node)
  if (header.length === 16) header.writeBigUInt64BE(BigInt(size), 8)
  else {
    if (size > 0xFFFFFFFF) throw new Skip('box too large')
    header.writeUInt32BE(size, 0)
  }
  parts.push(header)
  if (node.children) {
    if (node.prefix) parts.push(node.prefix)
    for (const child of node.children) serializeInto(child, parts)
    if (node.tail) parts.push(node.tail)
  }
  else parts.push(node.payload!)
}

function serialize(node: Node): Buffer {
  const parts: Buffer[] = []
  serializeInto(node, parts)
  return Buffer.concat(parts)
}

const childrenOf = (node: Node | undefined, type: string) => node?.children?.filter(child => child.type === type) ?? []

// ─── Métadonnées conservées (§ 18.3) ─────────────────────────────────────────

/** `udta` : noms et rôles des pistes, chapitres, textes éditoriaux ; `meta` filtré à part. */
const UDTA_KEPT = new Set(['name', 'kind', 'tsel', 'chpl', '©nam', '©des', '©cmt', 'cprt', '©cpy', 'titl', 'dscp'])
/** Liste iTunes (`meta` de gestionnaire `mdir`) : titre, descriptions, commentaire, droits d'auteur. */
const ILST_KEPT = new Set(['©nam', 'desc', '©des', 'ldes', '©cmt', 'cprt'])
/** Clés QuickTime (`meta` de gestionnaire `mdta`). */
const MDTA_KEPT = new Set([
  'com.apple.quicktime.title',
  'com.apple.quicktime.description',
  'com.apple.quicktime.comment',
  'com.apple.quicktime.copyright',
])
/** Bourrage : retiré seulement quand le fichier est réécrit pour une autre raison. */
const PADDING = new Set(['free', 'skip', 'wide'])

/** Filtre une boîte `meta` ; null si rien n'y reste. */
function filterMeta(meta: Node, path: string, removed: string[]): Node | null {
  const hdlr = childrenOf(meta, 'hdlr')[0]
  const handler = hdlr?.payload && hdlr.payload.length >= 12 ? hdlr.payload.toString('latin1', 8, 12) : ''
  const ilst = childrenOf(meta, 'ilst')[0]
  const drop = (reason: string) => {
    removed.push(`${path}/meta${reason}`)
    return null
  }
  if (!hdlr || !ilst?.children) return drop(handler ? `(${handler})` : '')

  let items: Node[]
  const kept: Node[] = [hdlr]
  if (handler === 'mdta') {
    const keys = childrenOf(meta, 'keys')[0]
    if (!keys?.payload || keys.payload.length < 8) return drop('(mdta)')
    const payload = keys.payload
    const count = payload.readUInt32BE(4)
    const entries: { index: number, raw: Buffer, name: string }[] = []
    for (let offset = 8, index = 1; index <= count; index++) {
      if (offset + 8 > payload.length) return drop('(mdta)')
      const size = payload.readUInt32BE(offset)
      if (size < 8 || offset + size > payload.length) return drop('(mdta)')
      entries.push({ index, raw: payload.subarray(offset, offset + size), name: payload.toString('utf8', offset + 8, offset + size) })
      offset += size
    }
    const keptEntries = entries.filter(entry => MDTA_KEPT.has(entry.name))
    for (const entry of entries) if (!MDTA_KEPT.has(entry.name)) removed.push(`${path}/meta/keys:${entry.name}`)
    const renumber = new Map(keptEntries.map((entry, i) => [entry.index, i + 1]))
    items = []
    for (const item of ilst.children) {
      const next = item.header.length >= 8 ? renumber.get(item.header.readUInt32BE(4)) : undefined
      if (next === undefined) continue
      const header = Buffer.from(item.header)
      header.writeUInt32BE(next, 4)
      items.push({ ...item, header })
    }
    if (!items.length) return null
    const head = Buffer.from(payload.subarray(0, 8))
    head.writeUInt32BE(keptEntries.length, 4)
    kept.push({ ...keys, payload: Buffer.concat([head, ...keptEntries.map(entry => entry.raw)]) })
  }
  else if (handler === 'mdir') {
    items = ilst.children.filter((item) => {
      if (ILST_KEPT.has(item.type)) return true
      removed.push(`${path}/meta/ilst/${item.type}`)
      return false
    })
    if (!items.length) return null
  }
  else return drop(`(${handler})`)

  for (const child of meta.children!) {
    if (child !== hdlr && child.type !== 'keys' && child.type !== 'ilst') removed.push(`${path}/meta/${child.type}`)
  }
  kept.push({ ...ilst, children: items })
  return { ...meta, children: kept, tail: undefined }
}

/** Filtre une boîte `udta` ; null si rien n'y reste. */
function filterUdta(udta: Node, path: string, removed: string[]): Node | null {
  const children: Node[] = []
  for (const child of udta.children ?? []) {
    if (child.type === 'meta') {
      const meta = filterMeta(child, `${path}/udta`, removed)
      if (meta) children.push(meta)
    }
    else if (UDTA_KEPT.has(child.type)) children.push(child)
    else removed.push(`${path}/udta/${child.type}`)
  }
  // La marque de fin QuickTime (4 octets nuls) n'est gardée qu'avec des boîtes à terminer.
  return children.length ? { ...udta, children, tail: udta.tail } : null
}

/** `moov` ou `trak` : métadonnées filtrées, boîtes `uuid` (XMP, données de fabricant) retirées. */
function filterContainer(node: Node, path: string, removed: string[]): Node {
  const children: Node[] = []
  for (const child of node.children ?? []) {
    const childPath = `${path}/${child.type}`
    if (child.type === 'uuid') removed.push(childPath)
    else if (child.type === 'udta') {
      const udta = filterUdta(child, path, removed)
      if (udta) children.push(udta)
    }
    else if (child.type === 'meta') {
      const meta = filterMeta(child, path, removed)
      if (meta) children.push(meta)
    }
    else if (child.type === 'trak') children.push(filterContainer(child, childPath, removed))
    else children.push(child)
  }
  return { ...node, children }
}

// ─── Plan ────────────────────────────────────────────────────────────────────

/** Tables de décalages et refus des cas non gérés (décalages absolus ailleurs, données externes). */
function chunkTables(moov: Node): Node[] {
  const tables: Node[] = []
  const visit = (node: Node) => {
    switch (node.type) {
      case 'mvex':
        throw new Skip('fragmented file')
      case 'cmov':
        throw new Skip('compressed movie header')
      case 'rmra':
        throw new Skip('reference movie')
      case 'saio':
        throw new Skip('auxiliary information offsets (encrypted file)')
      case 'stco':
      case 'co64':
        tables.push(node)
        break
      case 'dref': {
        // Chaque entrée doit être « autonome » (drapeau 1) : données dans ce fichier.
        const payload = node.payload!
        const count = payload.length >= 8 ? payload.readUInt32BE(4) : 0
        for (let offset = 8, i = 0; i < count; i++) {
          if (offset + 12 > payload.length) throw new Skip('invalid data reference')
          const size = payload.readUInt32BE(offset)
          if (size < 12) throw new Skip('invalid data reference')
          if ((payload.readUInt32BE(offset + 8) & 1) !== 1) throw new Skip('external data reference')
          offset += size
        }
        break
      }
    }
    node.children?.forEach(visit)
  }
  visit(moov)
  return tables
}

/**
 * Plan de la sortie, ou null si elle serait identique au fichier d'origine. Lève `Skip` pour un fichier
 * non géré.
 */
async function plan(source: ByteSource, options: PreparationOptions): Promise<PreparationPlan | null> {
  const boxes = await topLevelBoxes(source)
  if (boxes[0]?.type !== 'ftyp') throw new Skip('missing ftyp')
  const moovs = boxes.filter(box => box.type === 'moov')
  if (moovs.length !== 1) throw new Skip(moovs.length ? 'several moov boxes' : 'no moov box')
  if (boxes.some(box => box.type === 'moof')) throw new Skip('fragmented file')
  const moovBox = moovs[0]!
  if (moovBox.end - moovBox.start > MAX_MOOV_SIZE) throw new Skip('moov larger than 64 MiB')

  const buffer = await readRange(source, moovBox.start, moovBox.end - moovBox.start)
  const parsed = parseNodes(buffer, 0, buffer.length, { nodes: 0 }, 0).nodes
  if (parsed.length !== 1 || parsed[0]!.type !== 'moov') throw new Skip('invalid moov box')
  const original = parsed[0]!
  const tables = chunkTables(original)

  const removed: string[] = []
  const moov = options.metadata ? filterContainer(original, 'moov', removed) : original
  // Premier niveau : métadonnées retirées (`uuid`, `meta`, vendeurs…), bourrage gardé tant que rien d'autre ne change.
  const others = boxes.filter(box => box.type !== 'moov')
  const droppedTop = options.metadata ? others.filter(box => !['ftyp', 'mdat'].includes(box.type) && !PADDING.has(box.type)) : []
  for (const box of droppedTop) removed.push(box.type === 'uuid' && (box.end - box.start) >= box.header + 16 ? `uuid${await xmpSuffix(source, box)}` : box.type)

  const firstMdat = others.findIndex(box => box.type === 'mdat')
  if (firstMdat < 0) throw new Skip('no mdat box')
  const moveIndex = options.faststart && moovBox.start > others[firstMdat]!.start
  if (!moveIndex && !removed.length) return null

  // Rien d'autre que le strict nécessaire dans un fichier réécrit : le bourrage part aussi.
  const kept = others.filter(box => !droppedTop.includes(box) && !(options.metadata && PADDING.has(box.type)))
  const keptFirstMdat = kept.findIndex(box => box.type === 'mdat')
  const order: (TopBox | 'moov')[] = moveIndex
    ? [...kept.slice(0, keptFirstMdat), 'moov', ...kept.slice(keptFirstMdat)]
    : [...kept.filter(box => box.start < moovBox.start), 'moov', ...kept.filter(box => box.start > moovBox.start)]
  for (const box of others) if (options.metadata && PADDING.has(box.type)) removed.push(box.type)

  const moovSize = nodeSize(moov)
  const positions = new Map<TopBox, number>()
  let cursor = 0
  for (const entry of order) {
    if (entry === 'moov') cursor += moovSize
    else {
      positions.set(entry, cursor)
      cursor += entry.end - entry.start
    }
  }

  // Décalages des blocs : même position dans la boîte `mdat`, déplacée.
  const mdats = kept.filter(box => box.type === 'mdat')
  const chunks: { from: number, to: number }[] = []
  for (const table of tables) {
    const wide = table.type === 'co64'
    const payload = Buffer.from(table.payload!)
    if (payload.length < 8) throw new Skip('invalid chunk offset table')
    const count = payload.readUInt32BE(4)
    if (8 + count * (wide ? 8 : 4) > payload.length) throw new Skip('truncated chunk offset table')
    for (let i = 0; i < count; i++) {
      const at = 8 + i * (wide ? 8 : 4)
      const from = wide ? Number(payload.readBigUInt64BE(at)) : payload.readUInt32BE(at)
      const box = mdats.find(candidate => from >= candidate.start + candidate.header && from < candidate.end)
      if (!box) throw new Skip('chunk offset outside media data')
      const to = from - box.start + positions.get(box)!
      if (wide) payload.writeBigUInt64BE(BigInt(to), at)
      else if (to > 0xFFFFFFFF) throw new Skip('chunk offset beyond 32 bits')
      else payload.writeUInt32BE(to, at)
      chunks.push({ from, to })
    }
    // Les tables sont partagées entre l'arbre d'origine et l'arbre filtré (mêmes objets).
    table.payload = payload
  }

  const moovBytes = serialize(moov)
  if (moovBytes.length !== moovSize) throw new Skip('inconsistent moov size')
  const pieces: PreparationPiece[] = order.map(entry => (entry === 'moov' ? moovBytes : { start: entry.start, end: entry.end }))
  const operations: VideoPreparation[] = []
  if (moveIndex) operations.push('faststart')
  if (removed.some(path => !PADDING.has(path))) operations.push('metadata')
  return { pieces, size: cursor, operations, removed, chunks }
}

async function xmpSuffix(source: ByteSource, box: TopBox): Promise<string> {
  const id = await source.read(box.start + box.header, 16)
  return id.equals(XMP_UUID) ? '(XMP)' : ''
}

// ─── Sortie virtuelle et vérification ────────────────────────────────────────

/** Lecture de la sortie sans l'écrire : morceaux en mémoire ou plages de la source. */
export function plannedSource(source: ByteSource, prepared: PreparationPlan): ByteSource {
  const starts: number[] = []
  let cursor = 0
  for (const piece of prepared.pieces) {
    starts.push(cursor)
    cursor += Buffer.isBuffer(piece) ? piece.length : piece.end - piece.start
  }
  return guardedSource(prepared.size, async (offset, length) => {
    const parts: Buffer[] = []
    let position = offset
    const end = offset + length
    for (let i = 0; i < prepared.pieces.length && position < end; i++) {
      const piece = prepared.pieces[i]!
      const start = starts[i]!
      const size = Buffer.isBuffer(piece) ? piece.length : piece.end - piece.start
      if (position >= start + size) continue
      const from = position - start
      const take = Math.min(size - from, end - position)
      parts.push(Buffer.isBuffer(piece) ? piece.subarray(from, from + take) : await source.read(piece.start + from, take))
      position += take
    }
    return Buffer.concat(parts)
  })
}

function sameTracks(a: IsoMovie, b: IsoMovie): boolean {
  if (a.tracks.length !== b.tracks.length) return false
  return a.tracks.every((track, i) => {
    const other = b.tracks[i]!
    return track.id === other.id && track.handler === other.handler && track.codec === other.codec
      && track.codecString === other.codecString && track.duration === other.duration
      && track.width === other.width && track.height === other.height && track.rotation === other.rotation
  })
}

/** Indices des blocs comparés : premier, dernier et intermédiaires réguliers. */
function sampleIndices(count: number): number[] {
  if (count <= CHECKED_CHUNKS) return Array.from({ length: count }, (_, i) => i)
  return Array.from({ length: CHECKED_CHUNKS }, (_, i) => Math.round(i * (count - 1) / (CHECKED_CHUNKS - 1)))
}

/** Écart entre la sortie et l'original (message), ou null si la sortie est conforme. */
async function verify(source: ByteSource, output: ByteSource, mimeType: string, prepared: PreparationPlan, options: PreparationOptions): Promise<{ problem: string } | { probe: VideoProbe }> {
  const [before, after] = [await probeIsoBmff(source), await probeIsoBmff(output)]
  if (!sameTracks(before, after)) return { problem: 'tracks differ after preparation' }
  if (before.duration !== after.duration) return { problem: 'duration differs after preparation' }
  const [expected, probe] = [await probeVideo(source, mimeType), await probeVideo(output, mimeType)]
  for (const key of ['width', 'height', 'duration'] as const) {
    if (expected[key] !== probe[key]) return { problem: `${key} differs after preparation` }
  }
  for (const key of ['container', 'videoCodec', 'audioCodec', 'codecs', 'hasAudio', 'rotation', 'playback'] as const) {
    if (expected.metadata[key] !== probe.metadata[key]) return { problem: `${key} differs after preparation` }
  }
  // `dataTracks` : mêmes pistes (`sameTracks`), donc même liste. La préparation ne retire jamais une piste,
  // pas même une piste de données de l'appareil (GPS) : elle reste signalée, retirée par le traitement (D3).
  if (options.faststart && !probe.metadata.faststart) return { problem: 'index still after the media data' }
  if (options.metadata && probe.metadata.hasLocation) return { problem: 'location still present' }
  for (const index of sampleIndices(prepared.chunks.length)) {
    const { from, to } = prepared.chunks[index]!
    const [a, b] = [await source.read(from, CHECKED_BYTES), await output.read(to, CHECKED_BYTES)]
    if (!a.equals(b)) return { problem: `sample data moved incorrectly (chunk at ${from})` }
  }
  return { probe }
}

/**
 * Prépare un MP4/MOV (`video/mp4`, `video/quicktime`) : plan vérifié, ou raison de le garder tel quel.
 * Ne lève jamais pour un fichier non géré (le fichier a déjà été accepté par l'analyse).
 */
export async function prepareVideo(source: ByteSource, mimeType: string, options: PreparationOptions): Promise<PreparationOutcome> {
  if (mimeType !== 'video/mp4' && mimeType !== 'video/quicktime') return { status: 'skipped', reason: 'not an ISO BMFF file' }
  if (!options.faststart && !options.metadata) return { status: 'unchanged' }
  try {
    const prepared = await plan(source, options)
    if (!prepared) return { status: 'unchanged' }
    const checked = await verify(source, plannedSource(source, prepared), mimeType, prepared, options)
    if ('problem' in checked) return { status: 'skipped', reason: `verification failed: ${checked.problem}` }
    return {
      status: 'prepared',
      plan: prepared,
      probe: { ...checked.probe, metadata: { ...checked.probe.metadata, prepared: prepared.operations } },
    }
  }
  catch (error) {
    if (error instanceof Skip) return { status: 'skipped', reason: error.message }
    if (error instanceof VideoProbeError) return { status: 'skipped', reason: `verification failed: ${error.message}` }
    throw error
  }
}

/** Flux du fichier préparé : plages du fichier d'origine et morceaux en mémoire, dans l'ordre. */
export function preparedStream(path: string, prepared: PreparationPlan): Readable {
  async function* pieces() {
    for (const piece of prepared.pieces) {
      if (Buffer.isBuffer(piece)) yield piece
      else if (piece.end > piece.start) yield* createReadStream(path, { start: piece.start, end: piece.end - 1 })
    }
  }
  return Readable.from(pieces())
}
