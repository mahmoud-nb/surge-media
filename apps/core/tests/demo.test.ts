import { describe, expect, it } from 'vitest'
import { parseDemoManifest, safeArchiveName, tarExecutable } from '../cli/lib/demo-archive'
import {
  DEMO_LEGAL_REQUIRED,
  DEMO_LOG_RETENTION_DEFAULT,
  DEMO_RESET_INTERVAL_DEFAULT,
  DEMO_UPLOAD_QUOTA_DEFAULT,
  demoQuotaPerAddress,
  isDemoReference,
  mailtoAddress,
  nextDemoReset,
  parseDemoAccounts,
  parseDemoInterval,
  parseDemoLegal,
  parseDemoQuota,
  parseDemoReference,
  safeDemoLink,
} from '../shared/utils/demo'

const at = (iso: string) => Date.parse(iso)
const iso = (ms: number) => new Date(ms).toISOString()

describe('remise à zéro de la démo : créneaux', () => {
  it('toutes les 2 heures, alignées sur minuit UTC', () => {
    expect(iso(nextDemoReset(at('2026-10-30T13:12:00Z'), 120))).toBe('2026-10-30T14:00:00.000Z')
    expect(iso(nextDemoReset(at('2026-10-30T00:30:00Z'), 120))).toBe('2026-10-30T02:00:00.000Z')
  })

  it('au moins 10 minutes après le démarrage : un redémarrage juste avant un créneau saute au suivant', () => {
    expect(iso(nextDemoReset(at('2026-10-30T13:50:00Z'), 120))).toBe('2026-10-30T14:00:00.000Z')
    expect(iso(nextDemoReset(at('2026-10-30T13:50:01Z'), 120))).toBe('2026-10-30T16:00:00.000Z')
    // Relance par la remise à zéro elle-même, quelques secondes après le créneau.
    expect(iso(nextDemoReset(at('2026-10-30T14:00:15Z'), 120))).toBe('2026-10-30T16:00:00.000Z')
  })

  it('écart minimal plafonné à la moitié de l\'intervalle', () => {
    expect(iso(nextDemoReset(at('2026-10-30T13:00:20Z'), 2))).toBe('2026-10-30T13:02:00.000Z')
    expect(iso(nextDemoReset(at('2026-10-30T13:01:01Z'), 2))).toBe('2026-10-30T13:04:00.000Z')
  })

  it('passe minuit : le premier créneau du jour suivant est minuit', () => {
    expect(iso(nextDemoReset(at('2026-10-30T22:30:00Z'), 120))).toBe('2026-10-31T00:00:00.000Z')
    expect(iso(nextDemoReset(at('2026-10-30T23:55:00Z'), 120))).toBe('2026-10-31T02:00:00.000Z')
  })

  it('intervalle qui ne divise pas la journée : le compte repart de minuit', () => {
    // 7 h : 00:00, 07:00, 14:00, 21:00, puis minuit.
    expect(iso(nextDemoReset(at('2026-10-30T21:30:00Z'), 420))).toBe('2026-10-31T00:00:00.000Z')
    expect(iso(nextDemoReset(at('2026-10-30T08:00:00Z'), 420))).toBe('2026-10-30T14:00:00.000Z')
  })

  it('une fois par jour : minuit', () => {
    expect(iso(nextDemoReset(at('2026-10-30T12:00:00Z'), 1440))).toBe('2026-10-31T00:00:00.000Z')
  })
})

describe('configuration de la démo', () => {
  it('intervalle : entier de 1 à 1 440, sinon 120', () => {
    expect(parseDemoInterval('60')).toBe(60)
    expect(parseDemoInterval(1)).toBe(1)
    expect(parseDemoInterval(1440)).toBe(1440)
    for (const raw of [undefined, '', '0', '1441', '90.5', 'deux heures', -5]) expect(parseDemoInterval(raw)).toBe(DEMO_RESET_INTERVAL_DEFAULT)
  })

  it('volume par cycle : entier positif, sinon 1 Gio ; le quart par adresse IP', () => {
    expect(parseDemoQuota('536870912')).toBe(536870912)
    for (const raw of [undefined, '', '0', '-1', '1.5', 'beaucoup']) expect(parseDemoQuota(raw)).toBe(DEMO_UPLOAD_QUOTA_DEFAULT)
    expect(demoQuotaPerAddress(DEMO_UPLOAD_QUOTA_DEFAULT)).toBe(256 * 1024 * 1024)
    expect(demoQuotaPerAddress(3)).toBe(1)
  })

  it('comptes : JSON ou tableau déjà converti par Nitro, adresses en minuscules', () => {
    const json = '[{"email":" Admin@Demo.Example ","password":"démo admin 2026"},{"email":"editor@demo.example","password":"démo éditeur"}]'
    expect(parseDemoAccounts(json)).toEqual({
      accounts: [{ email: 'admin@demo.example', password: 'démo admin 2026' }, { email: 'editor@demo.example', password: 'démo éditeur' }],
      problem: null,
    })
    expect(parseDemoAccounts([{ email: 'a@b.example', password: 'x' }]).accounts).toHaveLength(1)
    expect(parseDemoAccounts('')).toEqual({ accounts: [], problem: null })
    expect(parseDemoAccounts(undefined)).toEqual({ accounts: [], problem: null })
  })

  it('comptes : JSON illisible, autre chose qu\'un tableau, entrées invalides ou au-delà de 4', () => {
    expect(parseDemoAccounts('[{').problem).toBe('JSON illisible')
    expect(parseDemoAccounts('{"email":"a@b.example"}').problem).toBe('un tableau JSON est attendu')
    const mixed = parseDemoAccounts([
      { email: 'sans-arobase', password: 'x' },
      { email: 'a@b.example' },
      { email: 'a@b.example', password: 'x'.repeat(257) },
      null,
      ...Array.from({ length: 5 }, (_, i) => ({ email: `u${i}@b.example`, password: 'x' })),
    ])
    expect(mixed.accounts.map(account => account.email)).toEqual(['u0@b.example', 'u1@b.example', 'u2@b.example', 'u3@b.example'])
    expect(mixed.problem).toBe('5 entrée(s) ignorée(s)')
  })

  it('liens du bandeau : https, http et mailto seulement', () => {
    expect(safeDemoLink(' mailto:contact@example.com ')).toBe('mailto:contact@example.com')
    expect(safeDemoLink('https://example.com/demo')).toBe('https://example.com/demo')
    for (const raw of ['javascript:alert(1)', 'data:text/html,x', 'example.com', '', undefined, 42]) expect(safeDemoLink(raw)).toBe('')
  })
})

describe('contenu de référence de la démo', () => {
  it('réglage demoReferenceAt : nombre ou texte numérique positif', () => {
    expect(parseDemoReference(1_790_000_000_000)).toBe(1_790_000_000_000)
    expect(parseDemoReference('1790000000000')).toBe(1_790_000_000_000)
    for (const value of [null, undefined, '', 'hier', 0, -1, Number.NaN, {}]) expect(parseDemoReference(value)).toBeNull()
  })

  it('référence : créé au plus tard à la capture', () => {
    const reference = at('2026-10-30T12:00:00Z')
    expect(isDemoReference(new Date('2026-10-30T11:59:59Z'), reference)).toBe(true)
    expect(isDemoReference(reference, reference)).toBe(true)
    expect(isDemoReference(new Date('2026-10-30T12:00:00.001Z'), reference)).toBe(false)
  })
})

describe('archive d\'un instantané de démo', () => {
  const manifest = { format: 1, createdAt: '2026-10-30T12:00:00.000Z', referenceAt: 1_793_361_600_000, coreVersion: '0.1.0', media: 'media' }

  it('descriptif valable', () => {
    expect(parseDemoManifest(JSON.stringify(manifest))).toEqual(manifest)
  })

  it('descriptif refusé : JSON illisible, autre format, date absente, dossier des médias hors de l\'archive', () => {
    for (const text of ['', '{', 'null', '[]']) expect(parseDemoManifest(text)).toBeNull()
    for (const patch of [{ format: 2 }, { referenceAt: 0 }, { referenceAt: '1793361600000' }, { createdAt: 5 }, { coreVersion: null }, { media: '../etc' }, { media: 'a/b' }, { media: '..' }, { media: 'database.sqlite' }, { media: 'surge-media-demo.json' }, { media: '' }]) {
      expect(parseDemoManifest(JSON.stringify({ ...manifest, ...patch }))).toBeNull()
    }
  })

  it('noms de dossier archivables', () => {
    for (const name of ['media', 'medias-2026', 'data.media', 'm_1']) expect(safeArchiveName(name)).toBe(true)
    for (const name of ['', '.', '..', 'a b', 'a/b', 'a\b', 'database.sqlite', 'x'.repeat(256)]) expect(safeArchiveName(name)).toBe(false)
  })

  it('tar de Windows sous Windows (jamais celui de Git Bash), celui du PATH ailleurs', () => {
    expect(tarExecutable('linux', {})).toBe('tar')
    expect(tarExecutable('darwin', {})).toBe('tar')
    if (process.platform === 'win32') expect(tarExecutable('win32', process.env).toLowerCase()).toMatch(/system32[/\\]tar\.exe$/)
    else expect(tarExecutable('win32', { SystemRoot: '/nonexistent' })).toBe('tar')
  })
})

describe('informations légales de la démo', () => {
  const complete = {
    publisherName: ' Jeanne Martin EI ',
    tradeName: 'Exemple',
    registration: 'SIRET 123 456 789 00012',
    address: '1 rue de l\'Exemple, 75000 Paris',
    email: 'contact@example.com',
    phone: '+33 1 23 45 67 89',
    director: '',
    hostName: 'Hébergeur SAS',
    hostAddress: '2 avenue de l\'Exemple, 59000 Lille',
    hostPhone: '',
    logRetentionDays: 30,
  }

  it('valeurs rognées, directeur de la publication = éditeur à défaut, rien ne manque', () => {
    const { legal, missing } = parseDemoLegal(complete)
    expect(legal?.publisherName).toBe('Jeanne Martin EI')
    expect(legal?.director).toBe('Jeanne Martin EI')
    expect(legal?.logRetentionDays).toBe(30)
    expect(missing).toEqual([])
    expect(parseDemoLegal({ ...complete, director: 'Jeanne Martin' }).legal?.director).toBe('Jeanne Martin')
  })

  it('sans éditeur : pas de pages légales ; champs obligatoires vides signalés', () => {
    expect(parseDemoLegal(undefined)).toEqual({ legal: null, missing: [...DEMO_LEGAL_REQUIRED] })
    const partial = parseDemoLegal({ publisherName: 'Jeanne Martin EI', email: 'contact@example.com' })
    expect(partial.legal).not.toBeNull()
    expect(partial.missing).toEqual(['address', 'hostName', 'hostAddress'])
  })

  it('éditeur non immatriculé (particulier) : ni nom commercial ni immatriculation, rien ne manque', () => {
    const { legal, missing } = parseDemoLegal({ ...complete, publisherName: 'Jeanne Martin', tradeName: '', registration: '' })
    expect(legal?.registration).toBe('')
    expect(legal?.director).toBe('Jeanne Martin')
    expect(missing).toEqual([])
  })

  it('nombres convertis par Nitro relus comme du texte ; durée de conservation bornée ; textes de 300 caractères au plus', () => {
    expect(parseDemoLegal({ ...complete, registration: 12345678900012 }).legal?.registration).toBe('12345678900012')
    for (const days of [0, -3, 1.5, 'trente', 4000]) expect(parseDemoLegal({ ...complete, logRetentionDays: days }).legal?.logRetentionDays).toBe(DEMO_LOG_RETENTION_DEFAULT)
    expect(parseDemoLegal({ ...complete, logRetentionDays: '90' }).legal?.logRetentionDays).toBe(90)
    expect(parseDemoLegal({ ...complete, address: 'x'.repeat(400) }).legal?.address).toHaveLength(300)
  })

  it('adresse d\'un lien mailto', () => {
    expect(mailtoAddress('mailto:abuse@example.com')).toBe('abuse@example.com')
    expect(mailtoAddress('mailto:abuse@example.com?subject=Signalement')).toBe('abuse@example.com')
    expect(mailtoAddress('https://example.com/report')).toBeNull()
    expect(mailtoAddress('mailto:')).toBeNull()
    expect(mailtoAddress('mailto:%E0%A4%A')).toBeNull()
  })
})
