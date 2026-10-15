// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { LOCALES } from './src/lib/locales.mjs';

/*
 * Public URL of the site. Defaults to the GitHub Pages project URL
 * (https://mahmoud-nb.github.io/surge-media/). With a custom domain, build with
 * SITE_URL=https://surge-media.example and BASE_PATH=/ (see README.md).
 */
const site = process.env.SITE_URL ?? 'https://mahmoud-nb.github.io';
const base = process.env.BASE_PATH ?? '/surge-media';

const repository = 'https://github.com/mahmoud-nb/surge-media';

// https://astro.build/config
export default defineConfig({
  site,
  base,
  // Every page is a directory (`/pricing/`): links written as relative paths resolve the same way
  // locally and on GitHub Pages, whatever the base.
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'surgeMedia',
      description:
        'Self-hosted media platform: store, transform and deliver images and videos from your own servers, through one secure headless API.',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        alt: '',
      },
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: LOCALES,
      social: [{ icon: 'github', label: 'GitHub', href: repository }],
      editLink: { baseUrl: `${repository}/edit/main/apps/website/` },
      lastUpdated: true,
      customCss: ['@fontsource-variable/inter', './src/styles/theme.css'],
      components: {
        Hero: './src/components/overrides/Hero.astro',
        SocialIcons: './src/components/overrides/SocialIcons.astro',
        Footer: './src/components/overrides/Footer.astro',
      },
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: new URL(`${base.replace(/\/$/, '')}/og.png`, site).href } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
      sidebar: [
        {
          label: 'Start here',
          translations: { fr: 'Commencer' },
          items: [
            { slug: 'guides/getting-started' },
            { slug: 'guides/architecture' },
            { slug: 'pricing' },
          ],
        },
        {
          label: 'Guides',
          translations: { fr: 'Guides' },
          items: [
            { slug: 'guides/environments' },
            { slug: 'guides/security' },
            { slug: 'guides/roles' },
          ],
        },
        {
          label: 'Reference',
          translations: { fr: 'Référence' },
          items: [{ slug: 'reference/image-transformations' }, { slug: 'reference/sdks' }],
        },
        {
          label: 'Project',
          translations: { fr: 'Projet' },
          items: [{ slug: 'license' }],
        },
      ],
    }),
  ],
});
