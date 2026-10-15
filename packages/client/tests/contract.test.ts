import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type {
  apiMediaListSchema,
  apiMediaProcessingSchema,
  apiMediaSourceSchema,
  apiMeSchema,
  apiPosterSchema,
  apiTextTrackSchema,
} from '../../../apps/core/shared/schemas/api'
import { apiMediaSchema, apiPresetSchema, apiProjectSchema } from '../../../apps/core/shared/schemas/api'
import { API_ERRORS } from '../../../apps/core/shared/utils/api'
import { CLIENT_MESSAGES } from '../src/i18n'
import type { Me, Media, MediaList, MediaProcessing, MediaSource, Poster, Preset, Project, TextTrack } from '../src/types'
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
