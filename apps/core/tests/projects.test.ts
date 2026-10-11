import { describe, expect, it } from 'vitest'
import { createProjectSchema } from '../shared/schemas/projects'
import { createUserSchema } from '../shared/schemas/users'
import { PROJECT_SLUG_MAX_LENGTH, PROJECT_SLUG_PATTERN, slugify } from '../shared/utils/projects'

describe('identifiant lisible des projets', () => {
  it('se déduit du nom (minuscules, sans accents ni ponctuation)', () => {
    expect(slugify('Site vitrine (été)')).toBe('site-vitrine-ete')
    expect(slugify('  --Hello__World--  ')).toBe('hello-world')
    expect(slugify('Ça marche !')).toBe('ca-marche')
    expect(slugify('App 2 · Production')).toBe('app-2-production')
  })

  it('peut être vide (le serveur choisit alors un nom générique)', () => {
    expect(slugify('')).toBe('')
    expect(slugify('✨🎉')).toBe('')
  })

  it('est tronqué sans laisser de tiret final', () => {
    const slug = slugify(`${'a'.repeat(59)} b ${'c'.repeat(20)}`)
    expect(slug.length).toBeLessThanOrEqual(PROJECT_SLUG_MAX_LENGTH)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).toMatch(PROJECT_SLUG_PATTERN)
  })

  it('respecte toujours le format attendu par l\'API', () => {
    for (const name of ['Mon Projet', 'École—2026', 'a  b', 'x-y-z']) {
      expect(slugify(name)).toMatch(PROJECT_SLUG_PATTERN)
    }
  })

  it('refuse les identifiants saisis mal formés', () => {
    for (const slug of ['Majuscule', 'avec espace', '-debut', 'fin-', 'double--tiret', 'accentué']) {
      expect(createProjectSchema.safeParse({ name: 'Projet', slug }).success).toBe(false)
    }
    expect(createProjectSchema.safeParse({ name: 'Projet', slug: 'site-2026' }).success).toBe(true)
  })

  it('exige un nom non vide', () => {
    const result = createProjectSchema.safeParse({ name: '   ' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('validation.required')
  })
})

describe('invitation rattachée à des projets', () => {
  const base = { email: 'invite@example.com', role: 'DEVELOPER' }

  it('accepte une invitation sans projet (administrateur ; le serveur en exige un d\'un gestionnaire)', () => {
    expect(createUserSchema.safeParse(base).success).toBe(true)
  })

  it('exige un rôle de projet dès qu\'un projet est choisi', () => {
    const result = createUserSchema.safeParse({ ...base, projectIds: ['p1'] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['projectRole'])
  })

  it('dédoublonne les projets choisis', () => {
    const result = createUserSchema.safeParse({ ...base, projectIds: ['p1', 'p2', 'p1'], projectRole: 'EDITOR' })
    expect(result.data?.projectIds).toEqual(['p1', 'p2'])
  })
})
