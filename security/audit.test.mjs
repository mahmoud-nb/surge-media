// Tests du classement de l'audit npm (security/audit.mjs) : node --test security/
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { checkExceptions, classify, isShipped, parsePath, summary } from './audit.mjs'

const production = { 'packages/client': new Set(['ofetch']), 'packages/vue': new Set(['@surge-media/client', 'vue']) }

function advisory(id, module, severity, paths) {
  return { github_advisory_id: id, module_name: module, severity, title: `${module} issue`, patched_versions: '>=2.0.0', url: `https://github.com/advisories/${id}`, findings: [{ version: '1.0.0', paths }] }
}

describe('audit des dépendances npm', () => {
  it('lit le projet et la dépendance directe d\'un chemin', () => {
    assert.deepEqual(parsePath('apps__core>nuxt>@nuxt/devtools>simple-git'), { project: 'apps/core', direct: 'nuxt' })
    assert.deepEqual(parsePath('.>release-it>proxy-agent'), { project: '.', direct: 'release-it' })
  })

  it('tient le core pour livré en entier, les bibliothèques par leurs dépendances de production', () => {
    assert.equal(isShipped(['apps__core>nuxt>seroval'], production), true)
    assert.equal(isShipped(['packages__vue>vue>@vue/shared'], production), true)
    assert.equal(isShipped(['packages__vue>@vue/test-utils>glob'], production), false)
    assert.equal(isShipped(['apps__website>astro>undici', '.>release-it>basic-ftp'], production), false)
  })

  it('bloque une alerte élevée livrée sans exception, pas le reste', () => {
    const report = { advisories: {
      1: advisory('GHSA-aaaa', 'vue-i18n', 'high', ['apps__core>@nuxtjs/i18n>vue-i18n']),
      2: advisory('GHSA-bbbb', 'undici', 'critical', ['apps__website>astro>undici']),
      3: advisory('GHSA-cccc', 'glob', 'moderate', ['apps__core>nuxt>glob']),
      4: advisory('GHSA-dddd', 'simple-git', 'critical', ['apps__core>nuxt>@nuxt/devtools>simple-git']),
    } }
    const exceptions = [
      { id: 'GHSA-dddd', package: 'simple-git', reason: 'outil de développement', added: '2026-11-06', expires: '2027-02-03' },
      { id: 'GHSA-zzzz', package: 'old', reason: 'corrigé depuis', added: '2026-11-06', expires: '2027-02-03' },
    ]
    const { findings, unused } = classify(report, { exceptions, production })
    const state = Object.fromEntries(findings.map(finding => [finding.package, finding.blocking]))
    assert.deepEqual(state, { 'vue-i18n': true, 'undici': false, 'glob': false, 'simple-git': false })
    assert.deepEqual(unused.map(entry => entry.id), ['GHSA-zzzz'])
    const text = summary({ findings, unused }, [])
    assert.match(text, /\*\*Échec\*\* : 1 alerte\(s\) bloquante\(s\)/)
    assert.match(text, /exception jusqu'au 2027-02-03/)
    assert.match(text, /GHSA-zzzz \(old\)/)
  })

  it('refuse les exceptions incomplètes, trop longues ou échues', () => {
    const now = Date.parse('2026-11-06T12:00:00Z')
    const { valid, errors } = checkExceptions([
      { id: 'GHSA-ok', package: 'a', reason: 'r', added: '2026-11-06', expires: '2027-02-04' },
      { id: 'GHSA-long', package: 'b', reason: 'r', added: '2026-11-06', expires: '2027-03-01' },
      { id: 'GHSA-old', package: 'c', reason: 'r', added: '2026-07-01', expires: '2026-09-01' },
      { id: 'GHSA-none', package: 'd', added: '2026-11-06', expires: '2026-12-01' },
    ], now)
    assert.deepEqual(valid.map(entry => entry.id), ['GHSA-ok'])
    assert.equal(errors.length, 3)
  })

  it('a un fichier d\'exceptions valable aujourd\'hui', () => {
    const entries = JSON.parse(readFileSync(new URL('./audit-exceptions.json', import.meta.url), 'utf8'))
    assert.deepEqual(checkExceptions(entries, Date.parse('2026-11-06T12:00:00Z')).errors, [])
  })
})
