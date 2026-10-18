import type { Media, SurgeClient, UploadRules } from '@surge-media/client'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSurgeMedia, SmUploader } from '../src'
import { imageMedia, videoMedia } from '../../client/tests/fixtures'

/**
 * SmUploader (architecture phase E, § 12.4) monté dans happy-dom avec un client simulé : aide reliée au
 * champ, pré-contrôle, file (progression, fin, annulation, nouvel essai, retrait et focus), mode
 * « détails », visibilité choisie ou imposée, annonces, composant indisponible sans droit d'envoi.
 */

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const rules: UploadRules = {
  types: [
    { mimeType: 'image/jpeg', extension: 'jpg', kind: 'image', maxSize: 1000, converted: false },
    { mimeType: 'image/png', extension: 'png', kind: 'image', maxSize: 1000, converted: false },
    { mimeType: 'video/mp4', extension: 'mp4', kind: 'video', maxSize: 5000, converted: false },
    { mimeType: 'video/x-matroska', extension: 'mkv', kind: 'video', maxSize: 5000, converted: true },
  ],
  remaining: 5,
  visibility: null,
  folderId: null,
}

interface PendingUpload {
  name: string
  fields: Record<string, unknown>
  resolve: (media: Media) => void
  reject: (error: unknown) => void
  progress: (fraction: number) => void
}

/** Client simulé : chaque envoi attend qu'on le termine. */
function fakeClient(uploadRules: UploadRules | null = rules) {
  const uploads: PendingUpload[] = []
  const client = {
    uploadRules: vi.fn(async () => uploadRules),
    media: {
      upload: vi.fn((_file: Blob, fields: Record<string, unknown>, options: { filename?: string, signal?: AbortSignal, onProgress?: (progress: { loaded: number, total: number, fraction: number }) => void } = {}) =>
        new Promise<Media>((resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          uploads.push({ name: options.filename ?? '', fields, resolve, reject, progress: fraction => options.onProgress?.({ loaded: fraction, total: 1, fraction }) })
        })),
      setPoster: vi.fn(async (id: string) => ({ ...videoMedia, id })),
    },
  }
  return { client: client as unknown as SurgeClient, uploads }
}

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type })

function mountUploader(client: SurgeClient | null, props: Record<string, unknown> = {}, locale = 'fr') {
  return mount(SmUploader, {
    props,
    attachTo: document.body,
    global: { plugins: [createSurgeMedia({ client: client ?? undefined, locale, loadProject: false })] },
  })
}

/** Choisit des fichiers dans le champ natif. */
async function choose(wrapper: ReturnType<typeof mountUploader>, files: File[]) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

const plain = (text: string) => text.replace(/[\u00A0\u202F]/g, ' ').replace(/\s+/g, ' ').trim()

describe('SmUploader', () => {
  it('règles lues par le client : aide reliée au champ, attribut accept, bouton libellé', async () => {
    const { client } = fakeClient()
    const wrapper = mountUploader(client)
    await flushPromises()
    const input = wrapper.find('input[type="file"]')
    const help = wrapper.find('.sm-uploader__help')
    expect(input.attributes('aria-describedby')).toBe(help.attributes('id'))
    expect(plain(help.text())).toContain('Images : JPG, PNG, 1 000 o au plus.')
    expect(plain(help.text())).toContain('Vidéos : MP4, 4,9 ko au plus.')
    expect(plain(help.text())).toContain('Vidéos converties après l\'envoi : MKV.')
    expect(plain(help.text())).toContain('Envois restants : 5.')
    expect(input.attributes('accept')).toContain('image/png')
    expect(input.attributes('accept')).toContain('.mkv')
    expect(input.attributes('multiple')).toBeDefined()
    expect(wrapper.find(`label[for="${input.attributes('id')}"]`).text()).toBe('Choisir des fichiers')
    wrapper.unmount()
  })

  it('file : progression, fin annoncée, événements, envois restants décomptés', async () => {
    const { client, uploads } = fakeClient()
    const wrapper = mountUploader(client, { visibility: 'private', folderId: 'cmfolder0001' })
    await flushPromises()
    await choose(wrapper, [file('a.png', 'image/png'), file('b.png', 'image/png')])
    expect(uploads.map(upload => upload.fields)).toEqual([{ visibility: 'private', folderId: 'cmfolder0001' }, { visibility: 'private', folderId: 'cmfolder0001' }])

    uploads[0]!.progress(0.4)
    await flushPromises()
    const progress = wrapper.find('.sm-uploader__item progress')
    expect(progress.attributes('aria-label')).toBe('Avancement de l\'envoi de « a.png »')
    expect(plain(wrapper.find('.sm-uploader__item .sm-uploader__state').text())).toBe('Envoi en cours : 40 %')

    uploads[0]!.resolve({ ...imageMedia, id: 'm-a' })
    uploads[1]!.resolve({ ...imageMedia, id: 'm-b' })
    await flushPromises()
    expect(wrapper.findAll('.sm-uploader__item--done')).toHaveLength(2)
    expect(wrapper.emitted('uploaded')?.map(([media]) => (media as Media).id)).toEqual(['m-a', 'm-b'])
    expect(wrapper.emitted('done')?.[0]?.[0]).toHaveLength(2)
    expect(wrapper.find('[role="status"]').text()).toBe('Envois terminés. Réussis : 2. En échec : 0.')
    expect(plain(wrapper.find('.sm-uploader__help').text())).toContain('Envois restants : 3.')
    wrapper.unmount()
  })

  it('pré-contrôle : refus visible et annoncé, sans envoi ni bouton « Réessayer » ; retrait, focus sur le champ', async () => {
    const { client, uploads } = fakeClient()
    const wrapper = mountUploader(client)
    await flushPromises()
    await choose(wrapper, [file('big.png', 'image/png', 2000)])
    expect(uploads).toHaveLength(0)
    const item = wrapper.find('.sm-uploader__item--error')
    expect(plain(item.find('.sm-uploader__error').text())).toBe('Ce fichier est trop volumineux. Taille maximale : 1 000 o.')
    expect(plain(wrapper.find('[role="status"]').text())).toContain('Échec de l\'envoi de « big.png »')
    expect(wrapper.emitted('error')).toHaveLength(1)
    const buttons = item.findAll('button')
    expect(buttons.map(button => button.attributes('aria-label'))).toEqual(['Retirer « big.png » de la liste'])
    await buttons[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.sm-uploader__item')).toHaveLength(0)
    expect(document.activeElement).toBe(wrapper.find('input[type="file"]').element)
    wrapper.unmount()
  })

  it('annulation puis nouvel essai ; focus gardé sur la ligne', async () => {
    const { client, uploads } = fakeClient()
    const wrapper = mountUploader(client)
    await flushPromises()
    await choose(wrapper, [file('a.png', 'image/png')])
    const cancel = wrapper.find('.sm-uploader__item button')
    expect(cancel.attributes('aria-label')).toBe('Annuler l\'envoi de « a.png »')
    expect(cancel.text()).toBe('Annuler')
    await cancel.trigger('click')
    await flushPromises()
    expect(wrapper.find('.sm-uploader__item--canceled').exists()).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Réessayer l\'envoi de « a.png »')
    await wrapper.find('.sm-uploader__item button').trigger('click')
    await flushPromises()
    expect(uploads).toHaveLength(2)
    expect(wrapper.find('.sm-uploader__item--uploading').exists()).toBe(true)
    wrapper.unmount()
  })

  it('mode « détails » : titre et texte alternatif saisis avant l\'envoi', async () => {
    const { client, uploads } = fakeClient()
    const wrapper = mountUploader(client, { details: true })
    await flushPromises()
    await choose(wrapper, [file('a.png', 'image/png'), file('clip.mp4', 'video/mp4')])
    expect(uploads).toHaveLength(0)
    const [image, video] = wrapper.findAll('.sm-uploader__item')
    const title = image!.find('input[type="text"]')
    expect(plain(image!.find(`label[for="${title.attributes('id')}"]`).text())).toBe('Titre (« a.png »)')
    const alt = image!.findAll('input[type="text"]')[1]!
    expect(alt.attributes('aria-describedby')).toBeTruthy()
    expect(video!.findAll('input[type="text"]')).toHaveLength(1) // pas de texte alternatif pour une vidéo
    await title.setValue('Plage')
    await alt.setValue('Une plage au coucher du soleil')
    await wrapper.find('.sm-uploader__footer .sm-uploader__button').trigger('click')
    await flushPromises()
    expect(uploads[0]!.fields).toEqual({ title: 'Plage', altText: 'Une plage au coucher du soleil' })
    expect(wrapper.find('.sm-uploader__details').exists()).toBe(false)
    wrapper.unmount()
  })

  it('visibilité : choix proposé, sauf si le jeton l\'impose', async () => {
    const { client, uploads } = fakeClient()
    const wrapper = mountUploader(client, { chooseVisibility: true }, 'en')
    await flushPromises()
    const select = wrapper.find('select')
    expect(wrapper.find(`label[for="${select.attributes('id')}"]`).text()).toBe('Visibility')
    await select.setValue('private')
    await choose(wrapper, [file('a.png', 'image/png')])
    expect(uploads[0]!.fields).toEqual({ visibility: 'private' })
    wrapper.unmount()

    const imposed = mountUploader(fakeClient().client, { chooseVisibility: true, rules: { ...rules, visibility: 'private', folderId: 'cmfolder0002' }, folderId: 'cmfolder0001' })
    await flushPromises()
    expect(imposed.find('select').exists()).toBe(false)
    imposed.unmount()
  })

  it('indisponible sans droit d\'envoi ou sans client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mountUploader(fakeClient(null).client)
    await flushPromises()
    expect(wrapper.find('.sm-uploader__unavailable').text()).toBe('L\'envoi de fichiers n\'est pas disponible.')
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    const withoutClient = mountUploader(null, {}, 'en')
    await flushPromises()
    expect(withoutClient.text()).toBe('File upload is not available.')
    withoutClient.unmount()
  })
})
