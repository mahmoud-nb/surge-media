import { describe, expect, it } from 'vitest'
import { decodeTextTrack, parseTextTrack, TEXT_TRACK_MAX_CUES, TextTrackError } from '../server/lib/media/text-track'

const utf8 = (text: string) => Buffer.from(text, 'utf8')
const parse = (text: string) => parseTextTrack(utf8(text))
/** Erreur attendue : numéro de ligne et début du message. */
function failure(text: string | Buffer): { line: number | null, message: string } {
  try {
    parseTextTrack(typeof text === 'string' ? utf8(text) : text)
  }
  catch (error) {
    if (error instanceof TextTrackError) return { line: error.line, message: error.message }
    throw error
  }
  throw new Error('erreur attendue')
}

describe('pistes de texte : WebVTT', () => {
  it('réécrit un fichier normalisé : horodatages complets, NOTE retirés, STYLE/REGION et réglages gardés', () => {
    const source = [
      'WEBVTT - Sous-titres',
      'Kind: captions',
      '',
      'STYLE',
      '::cue { color: yellow }',
      '',
      'REGION',
      'id:bas width:40% lines:3',
      '',
      'NOTE traduction à revoir',
      '',
      'intro',
      '01:02.5 --> 01:04.250 line:85% align:center position:50%,center inconnu:1 size:abc region:bas',
      '<v Ana>Bonjour <i>tout le monde</i></v>',
      'Deuxième ligne',
      '',
      '',
      '00:00:05.000 --> 00:00:06.000',
      '&amp; <c.jaune>fin</c>',
    ].join('\r\n')
    const result = parse(source)
    expect(result).toMatchObject({ cueCount: 2, sourceFormat: 'vtt' })
    expect(result.vtt).toBe([
      'WEBVTT',
      '',
      'STYLE',
      '::cue { color: yellow }',
      '',
      'REGION',
      'id:bas width:40% lines:3',
      '',
      'intro',
      '00:01:02.500 --> 00:01:04.250 line:85% align:center position:50%,center region:bas',
      '<v Ana>Bonjour <i>tout le monde</i></v>',
      'Deuxième ligne',
      '',
      '00:00:05.000 --> 00:00:06.000',
      '&amp; <c.jaune>fin</c>',
      '',
    ].join('\n'))
    // Normalisation stable : réécrire le résultat ne change rien.
    expect(parse(result.vtt).vtt).toBe(result.vtt)
  })

  it('tolère une réplique collée à l\'en-tête et une virgule décimale', () => {
    const result = parse('WEBVTT\n00:00:01,000 --> 00:00:02,000\nCollée\n')
    expect(result.vtt).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nCollée\n')
  })

  it('refuse : en-tête absent, temps invalides, fin avant le début, « --> » dans le texte, aucune réplique', () => {
    expect(failure('WEBVT\n\n00:00:01.000 --> 00:00:02.000\nx')).toMatchObject({ line: 1 })
    expect(failure('WEBVTT\n\n00:00:01.000 --> 00:00:61.000\nx')).toEqual({ line: 3, message: 'Invalid cue timing "00:00:01.000 --> 00:00:61.000".' })
    expect(failure('WEBVTT\n\n\nid\n00:00:03.000 --> 00:00:02.000\nx')).toEqual({ line: 5, message: 'The cue ends before it starts.' })
    expect(failure('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nun\n00:00:03.000 --> 00:00:04.000\ndeux')).toMatchObject({ line: 5 })
    expect(failure('WEBVTT\n\nidentifiant seul')).toMatchObject({ line: 3 })
    expect(failure('WEBVTT\n\nNOTE rien d\'autre\n')).toEqual({ line: null, message: 'The file contains no cue.' })
  })
})

describe('pistes de texte : SubRip (SRT)', () => {
  it('convertit en WebVTT : numéros, virgules, balises i/b/u gardées, font et ASS retirées, échappements', () => {
    const source = [
      '1',
      '00:00:01,000 --> 00:00:04,000 X1:100 X2:200 Y1:10 Y2:50',
      '{\\an8}<i>Bonjour</i> <font color="#ff0">à tous</font>',
      'Tom & Jerry : 3 < 4 > 2',
      '',
      '2',
      '00:00:05,500 --> 00:00:07,000',
      '<B>Fin</B><br>',
      '',
    ].join('\r\n')
    expect(parse(source)).toEqual({
      cueCount: 2,
      sourceFormat: 'srt',
      vtt: [
        'WEBVTT',
        '',
        '00:00:01.000 --> 00:00:04.000',
        '<i>Bonjour</i> à tous',
        'Tom &amp; Jerry : 3 &lt; 4 &gt; 2',
        '',
        '00:00:05.500 --> 00:00:07.000',
        '<b>Fin</b>',
        '',
      ].join('\n'),
    })
  })

  it('anciens SRT en Windows-1252, UTF-16 avec BOM, BOM UTF-8', () => {
    const latin = Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nL\xE9gende \x96 d\xE9j\xE0 vu\r\n', 'latin1')
    expect(parseTextTrack(latin).vtt).toContain('Légende – déjà vu')
    const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nÉté\n', 'utf16le')])
    expect(parseTextTrack(utf16).vtt).toContain('Été')
    expect(decodeTextTrack(Buffer.from([0xEF, 0xBB, 0xBF, 0x57, 0x45]))).toBe('WE')
  })

  it('refuse : pas un fichier de sous-titres, données binaires, temps illisible', () => {
    expect(failure('Bonjour\nceci est un texte')).toMatchObject({ line: 1 })
    expect(failure(Buffer.from([0x31, 0x0A, 0x00, 0x2D, 0x2D, 0x3E]))).toMatchObject({ line: null })
    expect(failure('1\n00:00:01 --> 00:00:02\ntexte')).toMatchObject({ line: 2 })
    expect(failure('1\n00:00:01,000 --> 00:00:02,000\nun\n\n2\nsans temps')).toEqual({ line: 5, message: 'Expected a cue timing ("00:00:01,000 --> 00:00:04,000").' })
  })
})

describe('pistes de texte : limites', () => {
  it('taille, nombre de répliques, longueur d\'une réplique', () => {
    expect(failure(Buffer.alloc(1024 * 1024 + 1, 0x41)).message).toMatch(/exceeds/)
    const many = Array.from({ length: TEXT_TRACK_MAX_CUES + 1 }, (_, i) => `00:00:00.000 --> 00:00:01.${String(i % 999 + 1).padStart(3, '0')}\nx`).join('\n\n')
    expect(failure(`WEBVTT\n\n${many}`).message).toMatch(/More than 20000 cues/)
    expect(failure(`WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${'a'.repeat(2001)}`).message).toMatch(/longer than 2000/)
  })
})
