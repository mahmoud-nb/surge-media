import type { TransformFormat, TransformPolicy } from '#shared/utils/transforms'
import type { SignedAccess } from '../media/signing'

/**
 * Signature d'un lien délivré par l'API v1 (fonction pure, testée dans tests/transforms.test.ts) :
 * architecture phase C § 5.2, § 5.3 et § 7. Le lien lui-même est construit par signed-urls.ts.
 */

/** Fichier demandé, une fois la transformation canonisée et le préréglage trouvé. */
export type SignedFile =
  | { kind: 'file' }
  | { kind: 'track', trackId: string }
  | { kind: 'preset', name: string, format: TransformFormat }
  | { kind: 'transform', canonical: string, format: TransformFormat }

export interface SignatureContext {
  visibility: 'PUBLIC' | 'PRIVATE'
  /** Politique des transformations libres du projet. */
  policy: TransformPolicy
  /** Lien demandé avec un jeton délégué : jamais de lien permanent. */
  delegated: boolean
}

export type SignaturePlan =
  /** URL utilisable sans signature. */
  | { type: 'none' }
  /** Signature sans échéance (dérivé précis d'un média public) : URL cachable sans limite. */
  | { type: 'permanent', access: { variant: string } }
  | { type: 'expiring', access: SignedAccess }
  /** L'URL ne serait jamais servie (403 TRANSFORM_NOT_ALLOWED). */
  | { type: 'refused', detail: string }

/** Droit signé désignant un fichier précis (signing.ts, `targetGrant`) : `original`, préréglage, `t:<canonique>`, `track:<piste>`. */
export function signedVariant(file: SignedFile): string {
  if (file.kind === 'file') return 'original'
  if (file.kind === 'track') return `track:${file.trackId}`
  return file.kind === 'preset' ? file.name : `t:${file.canonical}`
}

/**
 * Signature à délivrer pour `file` (cible exacte) ou, avec `derived`, pour tout dérivé de la version :
 *  - transformation libre dans un projet en politique `presets` : refusée ;
 *  - média privé : signature à échéance ;
 *  - média public : aucune, sauf en politique `signed` — transformation libre : signature
 *    permanente (à échéance pour un jeton délégué) ; droit `derived` : à échéance (jamais permanent).
 */
export function signaturePlan(file: SignedFile, derived: boolean, context: SignatureContext): SignaturePlan {
  if (file.kind === 'transform' && context.policy === 'PRESETS') {
    return { type: 'refused', detail: 'This project only serves presets: use a preset name instead of parameters.' }
  }
  const access: SignedAccess = derived ? { scope: 'derived' } : { variant: signedVariant(file) }
  if (context.visibility === 'PRIVATE') return { type: 'expiring', access }
  // Piste de texte d'un média public : URL publique, quelle que soit la politique des transformations.
  if (file.kind === 'track') return { type: 'none' }
  if (context.policy !== 'SIGNED') return { type: 'none' }
  if (derived) return { type: 'expiring', access }
  if (file.kind !== 'transform') return { type: 'none' }
  return context.delegated ? { type: 'expiring', access } : { type: 'permanent', access: { variant: signedVariant(file) } }
}
