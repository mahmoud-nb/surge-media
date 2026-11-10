import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type {
  apiMediaListSchema,
  apiMediaProcessingSchema,
  apiMediaSourceSchema,
  apiMeSchema,
  apiPosterSchema,
  apiTagRefSchema,
  apiTagSchema,
  apiTextTrackSchema,
  apiUploadRulesSchema,
} from '../../../apps/core/shared/schemas/api'
import { apiMediaSchema, apiPresetSchema, apiProjectSchema } from '../../../apps/core/shared/schemas/api'
import { API_ERRORS } from '../../../apps/core/shared/utils/api'
import { ACCEPTED_MEDIA_TYPES, CONVERTED_VIDEO_TYPES, mediaKindForMime } from '../../../apps/core/shared/utils/media'
import { CLIENT_MESSAGES } from '../src/i18n'
import type { Me, Media, MediaList, MediaProcessing, MediaSource, Poster, Preset, Project, Tag, TagRef, TextTrack, UploadRules, UploadTypeRule } from '../src/types'
import { UPLOAD_FILE_TYPES } from '../src/upload/file-types'
import { imageMedia, presets, privateImage, project, videoMedia } from './fixtures'

/**
 * Contrat avec le serveur : les types écrits à la main du client ont les mêmes champs que les schémas
 * zod de l'API v1 (apps/core/shared/schemas/api.ts) et leur sont assignables ; les exemples des tests
 * passent ces schémas. Un champ ajouté au serveur fait échouer `pnpm typecheck` du client.
 */

type Input<T extends z.ZodType> = z.input<T>

describe('types du client = schémas de l\'API', () => {
  it('mêmes champs, types compatibles', () => {
    expectTypeOf<keyof Media>().toEqualTypeOf<keyof Input<typeof apiMediaSchema>>()
    expectTypeOf<Media>().toExtend<Input<typeof apiMediaSchema>>()
    expectTypeOf<keyof MediaSource>().toEqualTypeOf<keyof Input<typeof apiMediaSourceSchema>>()
    expectTypeOf<MediaSource>().toExtend<Input<typeof apiMediaSourceSchema>>()
    expectTypeOf<keyof MediaProcessing>().toEqualTypeOf<keyof Input<typeof apiMediaProcessingSchema>>()
    expectTypeOf<MediaProcessing>().toExtend<Input<typeof apiMediaProcessingSchema>>()
    expectTypeOf<keyof TextTrack>().toEqualTypeOf<keyof Input<typeof apiTextTrackSchema>>()
    expectTypeOf<TextTrack>().toExtend<Input<typeof apiTextTrackSchema>>()
    expectTypeOf<keyof Poster>().toEqualTypeOf<keyof Input<typeof apiPosterSchema>>()
    expectTypeOf<Poster>().toExtend<Input<typeof apiPosterSchema>>()
    expectTypeOf<keyof Project>().toEqualTypeOf<keyof Input<typeof apiProjectSchema>>()
    expectTypeOf<Project>().toExtend<Input<typeof apiProjectSchema>>()
    expectTypeOf<keyof Preset>().toEqualTypeOf<keyof Input<typeof apiPresetSchema>>()
    expectTypeOf<Preset>().toExtend<Input<typeof apiPresetSchema>>()
    expectTypeOf<keyof Me>().toEqualTypeOf<keyof Input<typeof apiMeSchema>>()
    expectTypeOf<Me>().toExtend<Input<typeof apiMeSchema>>()
    expectTypeOf<keyof MediaList>().toEqualTypeOf<keyof Input<typeof apiMediaListSchema>>()
    expectTypeOf<keyof TagRef>().toEqualTypeOf<keyof Input<typeof apiTagRefSchema>>()
    expectTypeOf<TagRef>().toExtend<Input<typeof apiTagRefSchema>>()
    expectTypeOf<keyof Tag>().toEqualTypeOf<keyof Input<typeof apiTagSchema>>()
    expectTypeOf<Tag>().toExtend<Input<typeof apiTagSchema>>()
    expectTypeOf<keyof UploadRules>().toEqualTypeOf<keyof Input<typeof apiUploadRulesSchema>>()
    expectTypeOf<UploadRules>().toExtend<Input<typeof apiUploadRulesSchema>>()
    expectTypeOf<keyof UploadTypeRule>().toEqualTypeOf<keyof Input<typeof apiUploadRulesSchema>['types'][number]>()
  })

  it('types de fichiers du client = ceux que le serveur sait recevoir (extension, genre, format converti)', () => {
    const server: Record<string, string> = { ...CONVERTED_VIDEO_TYPES }
    for (const types of Object.values(ACCEPTED_MEDIA_TYPES)) Object.assign(server, types)
    expect(Object.fromEntries(Object.entries(UPLOAD_FILE_TYPES).map(([type, entry]) => [type, entry.extension]))).toEqual(server)
    for (const [type, entry] of Object.entries(UPLOAD_FILE_TYPES)) {
      expect(entry.kind, type).toBe(mediaKindForMime(type)?.toLowerCase())
      expect(entry.converted, type).toBe(type in CONVERTED_VIDEO_TYPES)
    }
  })

  it('les exemples passent les schémas du serveur', () => {
    for (const media of [imageMedia, privateImage, videoMedia]) expect(apiMediaSchema.parse(media)).toBeTruthy()
    expect(apiProjectSchema.parse(project)).toBeTruthy()
    for (const preset of presets) expect(apiPresetSchema.parse(preset)).toBeTruthy()
  })

  it('un message traduit pour chaque code d\'erreur du catalogue, dans chaque langue', () => {
    for (const messages of Object.values(CLIENT_MESSAGES)) {
      for (const code of Object.keys(API_ERRORS)) expect(messages.errors, code).toHaveProperty(code)
    }
  })
})
