import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';
import { FAQ_STATUSES } from './lib/faq';

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
  // FAQ questions (`/faq/`): one file per question and per language, `<lang>/<theme>/<slug>.md` (src/lib/faq.ts).
  faq: defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/faq' }),
    schema: z.object({
      question: z.string(),
      // Position in the theme.
      order: z.number().int(),
      // State of the feature the question is about (badge); none for informational questions.
      status: z.enum(FAQ_STATUSES).optional(),
      // Extra words the search should find (synonyms, acronyms).
      keywords: z.array(z.string()).default([]),
      // Pages to read next: site paths (`/guides/security/`), translated by locale, or full URLs.
      related: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
    }),
  }),
  // Interface strings of the site's own components (header, footer), on top of Starlight's.
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema({
      extend: z.object({
        'nav.docs': z.string(),
        'nav.faq': z.string(),
        'nav.pricing': z.string(),
        'nav.primary': z.string(),
        // Names of the code blocks that scroll (`{{language}}`: TypeScript, Shell…).
        'code.language': z.string(),
        'code.block': z.string(),
        'footer.tagline': z.string(),
        'footer.product': z.string(),
        'footer.resources': z.string(),
        'footer.legal': z.string(),
        'footer.gettingStarted': z.string(),
        'footer.architecture': z.string(),
        'footer.transformations': z.string(),
        'footer.security': z.string(),
        'footer.faq': z.string(),
        'footer.license': z.string(),
        'footer.changelog': z.string(),
        'footer.issues': z.string(),
        'footer.contact': z.string(),
        'footer.language': z.string(),
        'footer.copyright': z.string(),
        // FAQ page. `%count%`, `%shown%`, `%total%` and `%query%` are filled in by the page's script.
        'faq.themes': z.string(),
        'faq.audience': z.string(),
        'faq.count.one': z.string(),
        'faq.count.other': z.string(),
        'faq.count.filtered': z.string(),
        'faq.search.label': z.string(),
        'faq.search.placeholder': z.string(),
        'faq.search.hint': z.string(),
        'faq.results.total': z.string(),
        'faq.results.one': z.string(),
        'faq.results.other': z.string(),
        'faq.results.none': z.string(),
        'faq.expandAll': z.string(),
        'faq.collapseAll': z.string(),
        'faq.legend': z.string(),
        'faq.status.available': z.string(),
        'faq.status.partial': z.string(),
        'faq.status.planned': z.string(),
        'faq.statusHint.available': z.string(),
        'faq.statusHint.partial': z.string(),
        'faq.statusHint.planned': z.string(),
        'faq.related': z.string(),
        'faq.copyLink': z.string(),
        'faq.copied': z.string(),
        'faq.fallback': z.string(),
        'faq.empty.title': z.string(),
        'faq.empty.text': z.string(),
        'faq.empty.reset': z.string(),
        'faq.empty.ask': z.string(),
        'faq.empty.contact': z.string(),
      }),
    }),
  }),
};
