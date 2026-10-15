import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        // Landing pages: short label shown above the hero title.
        eyebrow: z.string().optional(),
        // Landing pages: terminal window beside the hero. Lines starting with `$ ` are commands,
        // with `# ` comments, the others output.
        heroTerminal: z
          .object({
            title: z.string(),
            lines: z.array(z.string()),
          })
          .optional(),
      }),
    }),
  }),
  // Interface strings of the site's own components (header, footer), on top of Starlight's.
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema({
      extend: z.object({
        'nav.docs': z.string(),
        'nav.pricing': z.string(),
        'nav.primary': z.string(),
        'footer.tagline': z.string(),
        'footer.product': z.string(),
        'footer.resources': z.string(),
        'footer.legal': z.string(),
        'footer.gettingStarted': z.string(),
        'footer.architecture': z.string(),
        'footer.transformations': z.string(),
        'footer.security': z.string(),
        'footer.license': z.string(),
        'footer.changelog': z.string(),
        'footer.issues': z.string(),
        'footer.contact': z.string(),
        'footer.language': z.string(),
        'footer.copyright': z.string(),
      }),
    }),
  }),
};
