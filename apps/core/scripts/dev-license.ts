/**
 * Licence de développement, pour essayer Réglages › Licence et les fonctions payantes avec `pnpm dev` :
 * signée par la clé de développement, acceptée seulement par `nuxt dev` (jamais par un build). Sa clé
 * privée est publique, ici même : elle ne protège rien. Les vraies licences sont émises par l'outil de
 * l'éditeur (dépôt privé), avec une clé de production que personne d'autre ne détient.
 *
 *   pnpm license:dev [--plan business] [--features sso,siem] [--instances 3] [--days 365] [--start=-340]
 *                    [--licensee "Acme SAS"] [--country FR]
 *
 * `--days` : validité à partir du début ; `--start` : décalage du début en jours (négatif = dans le passé,
 * pour une licence bientôt échue, en grâce ou échue). La licence est écrite sur la sortie standard.
 */
import { createPrivateKey } from 'node:crypto'
import { parseArgs } from 'node:util'
import { LICENSE_DEV_PUBLIC_KEY } from '../server/lib/license/keys'
import { signLicense } from '../server/lib/license/token'

const DEV_PRIVATE_KEY = { kty: 'OKP', crv: 'Ed25519', x: LICENSE_DEV_PUBLIC_KEY.x, d: 'cctsciMmBSYdOxlAiNwZbIGPcWBPnZLfrBgCuOX2FA4' }
const DAY = 24 * 60 * 60

const { values } = parseArgs({
  options: {
    plan: { type: 'string', default: 'business' },
    features: { type: 'string', default: 'sso' },
    instances: { type: 'string', default: '3' },
    days: { type: 'string', default: '365' },
    start: { type: 'string', default: '0' },
    licensee: { type: 'string', default: 'Acme SAS (développement)' },
    country: { type: 'string', default: 'FR' },
  },
})

const now = Math.floor(Date.now() / 1000)
const nbf = now + Math.round(Number(values.start) * DAY)
const exp = nbf + Math.round(Number(values.days) * DAY)
const instances = values.instances === 'unlimited' ? null : Number(values.instances)

const token = signLicense({
  v: 1,
  iss: 'surge-up',
  aud: 'surge-media',
  jti: `DEV-${new Date(now * 1000).getUTCFullYear()}-${String(now % 10_000).padStart(4, '0')}`,
  licensee: { name: values.licensee, ...(values.country ? { country: values.country } : {}) },
  plan: values.plan,
  features: values.features.split(',').map(feature => feature.trim()).filter(Boolean),
  instances,
  iat: now,
  nbf,
  exp,
  support: exp,
}, createPrivateKey({ key: DEV_PRIVATE_KEY, format: 'jwk' }), LICENSE_DEV_PUBLIC_KEY.kid)

console.log(token)
