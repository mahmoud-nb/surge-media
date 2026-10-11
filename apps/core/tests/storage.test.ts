import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Disk } from 'flydrive'
import { FSDriver } from 'flydrive/drivers/fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFlydriveStorage } from '../server/lib/storage/flydrive'

describe('stockage local : suppression par préfixe', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'surge-media-storage-'))
    await mkdir(join(root, 'media/variants/m1'), { recursive: true })
    for (const name of ['v1-a.webp', 'v1-b.jpg', 'v2-c.webp', 'v10-d.webp', 'poster-x.jpg']) {
      await writeFile(join(root, 'media/variants/m1', name), name)
    }
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  const storage = () => createFlydriveStorage('local', new Disk(new FSDriver({ location: root, visibility: 'private' })), 'media/')
  const files = () => readdir(join(root, 'media/variants/m1')).catch(() => [])

  it('début d\'un nom de fichier : seuls les fichiers concernés (dérivés d\'une ancienne version)', async () => {
    await storage().deletePrefix('variants/m1/v1-')
    expect((await files()).sort()).toEqual(['poster-x.jpg', 'v10-d.webp', 'v2-c.webp'])
  })

  it('dossier entier (purge d\'un média), dossier absent sans erreur', async () => {
    await storage().deletePrefix('variants/missing/v1-')
    await storage().deletePrefix('variants/missing/')
    await storage().deletePrefix('variants/m1/')
    expect(await files()).toEqual([])
  })
})
