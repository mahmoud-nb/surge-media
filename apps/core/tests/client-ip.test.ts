import { describe, expect, it } from 'vitest'
import { MAX_FORWARDED_HOPS, normalizeIp, resolveClientIp, trustedProxies, type TrustedProxies } from '../server/lib/http/client-ip'

const docker = trustedProxies(true) as TrustedProxies

describe('normalizeIp', () => {
  it('retire crochets, port, zone et préfixe IPv4 « mappé »', () => {
    expect(normalizeIp(' 203.0.113.7 ')).toBe('203.0.113.7')
    expect(normalizeIp('203.0.113.7:51234')).toBe('203.0.113.7')
    expect(normalizeIp('[2001:DB8::1]:443')).toBe('2001:db8::1')
    expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1')
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1')
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1')
    expect(normalizeIp('::ffff:172.18.0.3')).toBe('172.18.0.3')
  })

  it('refuse ce qui n\'est pas une adresse IP', () => {
    for (const value of ['', 'unknown', 'example.com', '999.1.1.1', '1.2.3', '_hidden', undefined, null]) expect(normalizeIp(value)).toBeNull()
  })
})

describe('trustedProxies', () => {
  it('true (défaut, absent ou vide) : boucle locale et réseaux privés', () => {
    for (const setting of [true, 'true', 'on', '1', undefined, '']) {
      const trusted = trustedProxies(setting)!
      for (const address of ['127.0.0.1', '::1', '10.1.2.3', '172.18.0.3', '192.168.1.10', 'fd00::5', 'fe80::1', '169.254.1.1']) {
        expect(trusted(address)).toBe(true)
      }
      for (const address of ['203.0.113.7', '172.32.0.1', '8.8.8.8', '2001:db8::1']) expect(trusted(address)).toBe(false)
    }
  })

  it('false : en-tête ignoré', () => {
    for (const setting of [false, 'false', 'FALSE', 'off', '0', 'no']) expect(trustedProxies(setting)).toBeNull()
  })

  it('liste : adresses, plages CIDR et mots-clés ; entrées invalides signalées et ignorées', () => {
    const warnings: string[] = []
    const trusted = trustedProxies('loopback, 203.0.113.10, 198.51.100.0/24, 2001:db8::/32, nimporte, 10.0.0.0/33', message => warnings.push(message))!
    expect(trusted('127.0.0.1')).toBe(true)
    expect(trusted('203.0.113.10')).toBe(true)
    expect(trusted('203.0.113.11')).toBe(false)
    expect(trusted('198.51.100.200')).toBe(true)
    expect(trusted('2001:db8:5::1')).toBe(true)
    expect(trusted('10.0.0.1')).toBe(false)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('nimporte')
  })

  it('aucune entrée valide : null (ne pas faire confiance en cas de doute)', () => {
    expect(trustedProxies('nimporte, quoi')).toBeNull()
  })
})

describe('resolveClientIp', () => {
  it('derrière un mandataire Docker : client réel', () => {
    expect(resolveClientIp('172.18.0.2', '203.0.113.7', docker)).toBe('203.0.113.7')
    expect(resolveClientIp('::ffff:172.18.0.2', '203.0.113.7', docker)).toBe('203.0.113.7')
    expect(resolveClientIp('172.18.0.2', '[2001:db8::7]:52000', docker)).toBe('2001:db8::7')
  })

  it('usurpation : une adresse écrite par le client à gauche est ignorée', () => {
    // nginx ($proxy_add_x_forwarded_for) ajoute l'adresse réelle à droite de ce qu'envoie le client.
    expect(resolveClientIp('172.18.0.2', '1.1.1.1, 203.0.113.7', docker)).toBe('203.0.113.7')
    expect(resolveClientIp('172.18.0.2', '10.0.0.5, 203.0.113.7', docker)).toBe('203.0.113.7')
  })

  it('connexion directe d\'une adresse publique : en-tête ignoré', () => {
    expect(resolveClientIp('203.0.113.7', '1.1.1.1', docker)).toBe('203.0.113.7')
    expect(resolveClientIp('::ffff:203.0.113.7', '10.0.0.1', docker)).toBe('::ffff:203.0.113.7')
  })

  it('plusieurs mandataires de confiance : on remonte jusqu\'au premier qui ne l\'est pas', () => {
    expect(resolveClientIp('10.0.0.2', '198.51.100.9, 203.0.113.7, 10.0.0.3', docker)).toBe('203.0.113.7')
    // CDN public déclaré en plus des réseaux privés.
    const withCdn = trustedProxies('private,203.0.113.0/24')!
    expect(resolveClientIp('10.0.0.2', '198.51.100.9, 203.0.113.7', withCdn)).toBe('198.51.100.9')
  })

  it('sans en-tête, ou entrée illisible : adresse de la connexion ou dernier mandataire sûr', () => {
    expect(resolveClientIp('172.18.0.2', undefined, docker)).toBe('172.18.0.2')
    expect(resolveClientIp('::ffff:172.18.0.2', '', docker)).toBe('::ffff:172.18.0.2')
    expect(resolveClientIp('::ffff:172.18.0.2', 'unknown', docker)).toBe('::ffff:172.18.0.2')
    expect(resolveClientIp('172.18.0.2', 'garbage, 10.0.0.9', docker)).toBe('10.0.0.9')
  })

  it('client interne (toutes les adresses de confiance) : la plus à gauche', () => {
    expect(resolveClientIp('127.0.0.1', '192.168.1.20, 10.0.0.3', docker)).toBe('192.168.1.20')
  })

  it('en-têtes multiples (tableau) et en-tête démesuré', () => {
    expect(resolveClientIp('172.18.0.2', ['1.1.1.1', '203.0.113.7'], docker)).toBe('203.0.113.7')
    const long = [...Array.from({ length: 1000 }, () => '203.0.113.99'), ...Array.from({ length: MAX_FORWARDED_HOPS }, () => '10.0.0.1')].join(',')
    expect(resolveClientIp('172.18.0.2', long, docker)).toBe('10.0.0.1')
  })

  it('liste sans réseau privé : la connexion d\'un conteneur n\'est pas un mandataire', () => {
    const only = trustedProxies('203.0.113.10')!
    expect(resolveClientIp('172.18.0.2', '198.51.100.9', only)).toBe('172.18.0.2')
    expect(resolveClientIp('203.0.113.10', '198.51.100.9', only)).toBe('198.51.100.9')
  })
})
